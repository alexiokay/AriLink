use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc as tokio_mpsc;
use silero_vad_rust::silero_vad::utils_vad::{VadIteratorParams, VadEvent};

/// Frame size in samples at 16kHz. 160 samples = 10ms.
pub const AEC_FRAME_SIZE: usize = 160;

/// Frame size in bytes (160 samples × 2 bytes/sample).
pub const AEC_FRAME_BYTES: usize = AEC_FRAME_SIZE * 2;

/// VAD chunk size: 512 samples = 32ms at 16kHz (Silero VAD v5 standard).
const VAD_CHUNK_SAMPLES: usize = 512;

/// Cooldown in VAD chunks after firing a user_speaking event.
/// 16 chunks × 32ms = 512ms — prevents rapid repeated events.
const SPEECH_COOLDOWN_VAD_CHUNKS: u32 = 16;

/// Minimum RMS (in i16-scaled units) for a VAD speech event to fire.
/// Filters out low-energy echo residual from user's speakers being picked up
/// by their mic. Real speech after AEC3 typically has RMS 700-8000+,
/// while speaker echo residual is much lower.
const SPEECH_MIN_RMS: f64 = 400.0;

/// Event emitted when real user speech is detected on post-AEC audio during TTS.
#[derive(Clone, Debug)]
pub struct UserSpeakingEvent {
    pub session_id: String,
    pub rms: f64,
}

/// Handle for sending audio to the AEC processing thread.
pub struct AecHandle {
    /// Send raw mic PCM (from RTP listener) to the AEC thread.
    pub mic_tx: std::sync::mpsc::Sender<Vec<u8>>,
    /// Send reference frames (from TTS injector) to the AEC thread.
    pub ref_tx: std::sync::mpsc::Sender<Vec<i16>>,
    /// Sender for user_speaking events. Subscribe via `.subscribe()`.
    pub speech_event_tx: tokio::sync::broadcast::Sender<UserSpeakingEvent>,
    /// Shared flag: true when TTS is actively playing. Set by TTS injector.
    pub tts_active: Arc<AtomicBool>,
    /// Join handle for graceful shutdown.
    _thread: std::thread::JoinHandle<()>,
}

impl AecHandle {
    /// Spawn a dedicated AEC processing thread.
    ///
    /// The thread owns the AEC3 processor + Silero VAD and processes mic frames
    /// through WebRTC-grade echo cancellation. Clean audio goes to `clean_tx`
    /// (transcription pipeline). During TTS playback, Silero VAD runs on the
    /// post-AEC signal to detect real user speech for barge-in.
    pub fn spawn(
        session_id: String,
        clean_tx: tokio_mpsc::Sender<Vec<u8>>,
    ) -> Self {
        let (mic_tx, mic_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let (ref_tx, ref_rx) = std::sync::mpsc::channel::<Vec<i16>>();
        let (speech_tx, _speech_rx) = tokio::sync::broadcast::channel::<UserSpeakingEvent>(16);
        let speech_tx_for_struct = speech_tx.clone();
        let tts_active = Arc::new(AtomicBool::new(false));
        let tts_active_clone = tts_active.clone();

        let thread = std::thread::Builder::new()
            .name(format!("aec-{}", &session_id[..session_id.len().min(12)]))
            .spawn(move || {
                aec_thread(session_id, mic_rx, ref_rx, clean_tx, speech_tx, tts_active_clone);
            })
            .expect("failed to spawn AEC thread");

        Self {
            mic_tx,
            ref_tx,
            speech_event_tx: speech_tx_for_struct,
            tts_active,
            _thread: thread,
        }
    }
}

/// Convert i16 PCM samples to f32 [-1.0, 1.0] for AEC3.
#[inline]
fn i16_to_f32(src: &[i16], dst: &mut [f32]) {
    for (i, &s) in src.iter().enumerate() {
        dst[i] = s as f32 / 32768.0;
    }
}

/// Convert f32 [-1.0, 1.0] samples back to i16 PCM.
#[inline]
fn f32_to_i16(src: &[f32], dst: &mut [i16]) {
    for (i, &s) in src.iter().enumerate() {
        dst[i] = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
    }
}

/// AEC processing thread entry point.
/// Uses WebRTC AEC3 for echo cancellation + Silero VAD for speech detection.
fn aec_thread(
    session_id: String,
    mic_rx: std::sync::mpsc::Receiver<Vec<u8>>,
    ref_rx: std::sync::mpsc::Receiver<Vec<i16>>,
    clean_tx: tokio_mpsc::Sender<Vec<u8>>,
    speech_tx: tokio::sync::broadcast::Sender<UserSpeakingEvent>,
    tts_active: Arc<AtomicBool>,
) {
    // ── AEC3 initialization ──
    let ns_config = aec3::audio_processing::ns::NsConfig {
        target_level: aec3::audio_processing::ns::SuppressionLevel::K12dB,
        analyze_linear_aec_output_when_available: true,
    };
    let aec_result = aec3::voip::VoipAec3::builder(16000, 1, 1)
        .enable_high_pass(true)
        .enable_noise_suppression(true)
        .noise_suppression_config(ns_config)
        .initial_delay_ms(100)
        .build();

    let mut aec = match aec_result {
        Ok(a) => {
            tracing::info!("[{}] AEC3 initialized (16kHz mono, NS=12dB, delay_hint=100ms)", session_id);
            Some(a)
        }
        Err(e) => {
            tracing::error!("[{}] AEC3 init failed: {:?} -- running passthrough", session_id, e);
            None
        }
    };

    // ── Silero VAD initialization ──
    // Wrapped in catch_unwind because ort may panic if libonnxruntime.so is missing
    let mut vad_iter: Option<silero_vad_rust::VadIterator> = None;
    match std::panic::catch_unwind(|| silero_vad_rust::load_silero_vad()) {
        Ok(Ok(model)) => {
            tracing::info!("[{}] Silero VAD model loaded (bundled ONNX)", session_id);
            let params = VadIteratorParams {
                threshold: 0.3,        // Lower for telephony (more sensitive)
                sampling_rate: 16000,
                min_silence_duration_ms: 100,
                speech_pad_ms: 30,
            };
            match silero_vad_rust::VadIterator::new(model, params) {
                Ok(v) => {
                    tracing::info!("[{}] Silero VadIterator created (threshold=0.3, 16kHz)", session_id);
                    vad_iter = Some(v);
                }
                Err(e) => {
                    tracing::error!("[{}] VadIterator creation failed: {:?}", session_id, e);
                }
            }
        }
        Ok(Err(e)) => {
            tracing::error!("[{}] Silero VAD load failed: {:?} -- speech detection disabled", session_id, e);
        }
        Err(_panic) => {
            tracing::error!("[{}] Silero VAD load panicked (likely missing libonnxruntime.so) -- speech detection disabled", session_id);
        }
    };

    // Ring buffer of reference frames from TTS injector
    let mut ref_queue: VecDeque<Vec<i16>> = VecDeque::with_capacity(64);
    let silence_i16 = vec![0i16; AEC_FRAME_SIZE];

    // Reusable f32 buffers (avoid per-frame allocation)
    let mut capture_f32 = vec![0f32; AEC_FRAME_SIZE];
    let mut render_f32 = vec![0f32; AEC_FRAME_SIZE];
    let mut output_f32 = vec![0f32; AEC_FRAME_SIZE];

    // Accumulator for partial mic frames (RTP packets may not align to AEC_FRAME_BYTES)
    let mut mic_buffer: Vec<u8> = Vec::with_capacity(AEC_FRAME_BYTES * 4);

    let mut frame_count: u64 = 0;

    // VAD accumulation buffer: collects post-AEC f32 output until we have 512 samples
    let mut vad_buffer: Vec<f32> = Vec::with_capacity(VAD_CHUNK_SAMPLES * 2);

    // Speech detection state
    let mut speech_cooldown: u32 = 0;

    tracing::info!(
        "[{}] AEC thread started (aec_frame={}samples, vad_chunk={}samples, cooldown={}chunks)",
        session_id, AEC_FRAME_SIZE, VAD_CHUNK_SAMPLES, SPEECH_COOLDOWN_VAD_CHUNKS
    );

    loop {
        // Block on mic audio (sender drops when session ends)
        let mic_data = match mic_rx.recv() {
            Ok(data) => data,
            Err(_) => {
                tracing::info!("[{}] AEC thread stopping (mic channel closed)", session_id);
                break;
            }
        };

        // Drain available reference frames (non-blocking)
        loop {
            match ref_rx.try_recv() {
                Ok(frame) => {
                    ref_queue.push_back(frame);
                    while ref_queue.len() > 100 {
                        ref_queue.pop_front();
                    }
                }
                Err(_) => break,
            }
        }

        mic_buffer.extend_from_slice(&mic_data);

        // Process in AEC_FRAME_BYTES chunks (10ms each)
        while mic_buffer.len() >= AEC_FRAME_BYTES {
            let frame_bytes: Vec<u8> = mic_buffer.drain(..AEC_FRAME_BYTES).collect();

            let mic_samples: Vec<i16> = frame_bytes
                .chunks_exact(2)
                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                .collect();

            let ref_samples = ref_queue.pop_front().unwrap_or_else(|| silence_i16.clone());

            // Run AEC3 or passthrough
            let output_i16 = if let Some(ref mut aec_proc) = aec {
                i16_to_f32(&mic_samples, &mut capture_f32);
                i16_to_f32(&ref_samples, &mut render_f32);

                match aec_proc.process(&capture_f32, Some(&render_f32), false, &mut output_f32) {
                    Ok(metrics) => {
                        if frame_count % 500 == 0 {
                            tracing::debug!(
                                "[{}] AEC3 metrics: ERL={:.1}dB, ERLE={:.1}dB, delay={}ms",
                                session_id, metrics.echo_return_loss,
                                metrics.echo_return_loss_enhancement, metrics.delay_ms
                            );
                        }
                        let mut out = vec![0i16; AEC_FRAME_SIZE];
                        f32_to_i16(&output_f32, &mut out);
                        out
                    }
                    Err(e) => {
                        if frame_count % 500 == 0 {
                            tracing::warn!("[{}] AEC3 process error: {:?}", session_id, e);
                        }
                        mic_samples.clone()
                    }
                }
            } else {
                mic_samples.clone()
            };

            frame_count += 1;

            // ── Accumulate post-AEC f32 output for VAD ──
            if aec.is_some() {
                vad_buffer.extend_from_slice(&output_f32[..AEC_FRAME_SIZE]);
            } else {
                for &s in &output_i16 {
                    vad_buffer.push(s as f32 / 32768.0);
                }
            }

            // ── Silero VAD speech detection (every ~32ms = 512 samples) ──
            while vad_buffer.len() >= VAD_CHUNK_SAMPLES {
                let vad_chunk: Vec<f32> = vad_buffer.drain(..VAD_CHUNK_SAMPLES).collect();

                if let Some(ref mut vad) = vad_iter {
                    // Always feed audio to keep VAD LSTM state current
                    match vad.process_chunk(&vad_chunk, false, 1) {
                        Ok(event) => {
                            let is_tts = tts_active.load(Ordering::Relaxed);

                            // Only act on speech during TTS playback
                            if is_tts {
                                if speech_cooldown > 0 {
                                    speech_cooldown -= 1;
                                }

                                if let Some(VadEvent::Start(_)) = event {
                                    if speech_cooldown == 0 {
                                        let out_rms = rms_f32(&vad_chunk);
                                        if out_rms >= SPEECH_MIN_RMS {
                                            speech_cooldown = SPEECH_COOLDOWN_VAD_CHUNKS;
                                            tracing::info!(
                                                "[{}] user_speaking detected by Silero VAD (rms={:.0})",
                                                session_id, out_rms
                                            );
                                            let _ = speech_tx.send(UserSpeakingEvent {
                                                session_id: session_id.clone(),
                                                rms: out_rms,
                                            });
                                        } else {
                                            tracing::debug!(
                                                "[{}] VAD speech detected but RMS too low ({:.0} < {}), likely speaker echo",
                                                session_id, out_rms, SPEECH_MIN_RMS
                                            );
                                        }
                                    }
                                }
                            } else {
                                // TTS not active — reset cooldown
                                speech_cooldown = 0;
                            }
                        }
                        Err(e) => {
                            if frame_count % 500 == 0 {
                                tracing::warn!("[{}] VAD process error: {:?}", session_id, e);
                            }
                        }
                    }
                }
            }

            // Periodic diagnostics (every 5 seconds = 500 AEC frames at 10ms)
            if frame_count % 500 == 0 {
                let mic_rms = rms_i16(&mic_samples);
                let ref_rms = rms_i16(&ref_samples);
                let out_rms = rms_i16(&output_i16);
                tracing::debug!(
                    "[{}] stats: frames={}, queue={}, mic_rms={:.0}, ref_rms={:.0}, out_rms={:.0}",
                    session_id, frame_count, ref_queue.len(), mic_rms, ref_rms, out_rms
                );
            }

            // Convert back to LE bytes and send to transcription pipeline
            let mut clean_bytes = Vec::with_capacity(AEC_FRAME_BYTES);
            for s in &output_i16 {
                clean_bytes.extend_from_slice(&s.to_le_bytes());
            }

            if clean_tx.try_send(clean_bytes).is_err() {
                tracing::trace!("[{}] AEC clean audio channel full", session_id);
            }
        }
    }
}

/// Compute RMS of i16 audio samples.
fn rms_i16(samples: &[i16]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum / samples.len() as f64).sqrt()
}

/// Compute RMS of f32 audio samples (scaled to match i16 range for logging).
fn rms_f32(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| {
        let s16 = (s as f64) * 32768.0;
        s16 * s16
    }).sum();
    (sum / samples.len() as f64).sqrt()
}
