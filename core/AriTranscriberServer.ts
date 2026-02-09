const WebSocket = require("ws");
const rtp = require("./rtp-udp-server");

const fs = require("fs");
const https = require("https");
const http = require("http");
const { Transform } = require("stream");
const googleProvider = require("../tools/google-speech-provider");
const transcriptionProvider = require("../tools/transcription-provider");
const EventEmitter = require("events");
const net = require("net");

interface AriTranscriberOptions {
  sslCert?: string;
  sslKey?: string;
  wssPort: number;
  format: "ulaw" | "slin16" | "opus";
  speechLang: string;
  speechModel: string;
  speakerDiarization: boolean;
  listenServer: string;
  audioOutput?: string;
}

interface SpeechResults {
  isFinal: boolean;
  alternatives: Array<{
    transcript: string;
    words?: Array<{
      word: string;
      speakerTag: number;
    }>;
  }>;
}

class AriTranscriber extends EventEmitter {
  private opts: AriTranscriberOptions;
  private webServer: any;
  private wssServer: any;
  private speechProvider: any;
  private audioServer: any;

  constructor(opts: AriTranscriberOptions) {
    super();
    this.opts = opts;
    // Run it.
    this.transcriber();
  }

  // The WebSocket server serves up the transcription.
  private startWebsocketServer(): void {
    this.webServer = this.opts.sslCert
      ? https.createServer({
          cert: fs.readFileSync(this.opts.sslCert),
          key: fs.readFileSync(this.opts.sslKey!),
        })
      : http.createServer();

    this.wssServer = new WebSocket.Server({ server: this.webServer });
    this.wssServer.on("connection", (ws: any, req: any) => {
      console.log("Connection from: ", req.connection.remoteAddress);

      ws.on("message", (message: any) => {
        console.log("Received WebSocket message:", message); // Log the received WebSocket message
      });

      // Example of sending a message to the WebSocket client
      ws.send("Hello, WebSocket client!"); // Log the sent WebSocket message
    });

    this.webServer.listen(this.opts.wssPort);
  }

  private async stopAudioServer(): Promise<void> {
    if (this.audioServer) {
      await this.audioServer.close();
      this.audioServer = null;
      console.log("Audio server stopped");
    }
  }

  /*
   * The transcriptCallback simply passes any text received from the
   * speech provider to any client connected to the WebSocket server.
   */
  private transcriptCallback(text: string, isFinal: boolean): void {
    if (isFinal && this.wssServer) {
      console.log("Received transcription:", text);
      this.wssServer.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(text);
        }
      });
    }
  }

  /*
   * The resultsCallback is just an example of how Google identifies
   * speakers if you have speakerDiarization enabled. We don't do
   * anything with this other than display the raw results on the console.
   */
  private resultsCallback(results: SpeechResults[]): void {
    if (results[0].isFinal) {
      const transcription = results
        .map((result) => result.alternatives[0].transcript)
        .join("\n");
      console.log(`Transcription: ${transcription}`);
      const wordsInfo = results[0].alternatives[0].words;
      if (wordsInfo) {
        wordsInfo.forEach((a) =>
          console.log(` word: ${a.word}, speakerTag: ${a.speakerTag}`)
        );
      }
    }
  }

  // The main wrapper
  private async transcriber(): Promise<void> {
    let speechEncoding: string;
    let speechRate: number;
    let swap16 = false;

    switch (this.opts.format) {
      case "ulaw":
        speechEncoding = "MULAW";
        speechRate = 8000;
        break;
      case "slin16":
        speechEncoding = "LINEAR16";
        speechRate = 16000;
        swap16 = true;
        break;
      case "opus":
        speechEncoding = "OPUS";
        speechRate = 24000;
        break;
      default:
        console.error(`Unknown format ${this.opts.format}`);
        return;
    }

    // Start the server that receives audio from Asterisk.
    console.log(`Starting audio listener on ${this.opts.listenServer}`);
    this.audioServer = new rtp.RtpUdpServerSocket(
      this.opts.listenServer,
      swap16,
      this.opts.audioOutput || false
    );

    this.audioServer.on("packet", (packet: any) => {
      console.log("Received RTP packet:", packet); // Log the received RTP packet
    });

    console.log("Starting speech provider");
    let config: any = {
      encoding: speechEncoding,
      sampleRateHertz: speechRate,
      languageCode: this.opts.speechLang,
      audioChannelCount: 1,
      model: this.opts.speechModel,
      useEnhanced: true,
      profanityFilter: false,
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      metadata: {
        interactionType: "DISCUSSION",
        microphoneDistance: "MIDFIELD",
        originalMediaType: "AUDIO",
        recordingDeviceName: "ConferenceCall",
      },
    };
    if (this.opts.speakerDiarization) {
      config.enableSpeakerDiarization = true;
      config.diarizationSpeakerCount = 5;
    }

    // Transcription services configuration
    // TRANSCRIPTION_SERVICES = comma-separated list of services (tries in order)
    // Example: ws://localhost:5000,ws://localhost:5001,google
    // Keyword "google" = Google Cloud Speech (requires GOOGLE_APPLICATION_CREDENTIALS)

    const servicesEnv = process.env.TRANSCRIPTION_SERVICES || "";
    const services = servicesEnv.split(",").map(s => s.trim()).filter(s => s.length > 0);

    if (services.length === 0) {
      console.error("❌ ERROR: TRANSCRIPTION_SERVICES is not configured!");
      throw new Error("Set TRANSCRIPTION_SERVICES (e.g., ws://localhost:5000 or ws://localhost:5000,google)");
    }

    console.log(`📋 Transcription services (in priority order):`);
    services.forEach((service, index) => {
      const label = index === 0 ? "PRIMARY" : `BACKUP ${index}`;
      if (service.toLowerCase() === "google") {
        console.log(`   ${label}: Google Cloud Speech ${index === 0 ? "⚠️ API costs apply" : "(fallback)"}`);
      } else {
        console.log(`   ${label}: ${service}`);
      }
    });

    // Validate Google credentials if "google" is in the list
    if (services.some(s => s.toLowerCase() === "google") && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error("❌ ERROR: 'google' in TRANSCRIPTION_SERVICES but no GOOGLE_APPLICATION_CREDENTIALS!");
      throw new Error("Configure GOOGLE_APPLICATION_CREDENTIALS to use Google Cloud Speech");
    }

    // Try services in order
    const primaryService = services[0];
    const fallbackServices = services.slice(1);

    if (primaryService.toLowerCase() === "google") {
      console.log("☁️ Starting with Google Cloud Speech as primary");
      this.speechProvider = new googleProvider.GoogleSpeechProvider(
        config,
        this.audioServer,
        (text: string, isFinal: boolean) => {
          this.transcriptCallback(text, isFinal);
        },
        (results: SpeechResults[]) => {
          if (this.opts.speakerDiarization) {
            this.resultsCallback(results);
          }
        }
      );
    } else {
      console.log(`🎙️ Starting with local service: ${primaryService}`);
      this.speechProvider = new transcriptionProvider.TranscriptionProvider(
        config,
        this.audioServer,
        (text: string, isFinal: boolean) => {
          this.transcriptCallback(text, isFinal);
        },
        primaryService,
        fallbackServices
      );
    }

    console.log("speechProvider started");

    // If wssPort was specified, start the WebSocket server.
    if (this.opts.wssPort > 0) {
      console.log(
        `Starting ${
          this.opts.sslCert ? "secure " : ""
        }transcription websocket server on port ${this.opts.wssPort}`
      );
      this.startWebsocketServer();
    }

    console.log("Processing");
  }
}

module.exports.AriTranscriber = AriTranscriber;
module.exports.AriTranscriberOptions = {};
