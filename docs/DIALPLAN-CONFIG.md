# 📞 FreePBX Dialplan Configuration for AriLinks

Advanced routing strategies for your AriLink application. Choose the routing strategy that best fits your needs.

> **📖 For basic dialplan setup** (`[stasis-app]` + `[from-trunk-custom]`), see [FREEPBX-ARI-CONFIGURATION.md](./FREEPBX-ARI-CONFIGURATION.md#2%EF%B8%8F%E2%83%A3-configure-custom-dialplan).
> **📖 For 3CX-specific routing** (`[to-3cx]` context), see [3CX-INTEGRATION.md](./3CX-INTEGRATION.md#part-3-create-custom-dialplan-recommended).

---

## 🎯 Configuration Options

Choose the routing strategy that fits your needs:

| Strategy | Use Case | Configuration |
|----------|----------|---------------|
| **Route ALL calls** | Every call gets transcribed | See [Option 1](#option-1-route-all-calls) |
| **Specific extensions only** | Only transcribe certain extensions | See [Option 2](#option-2-specific-extensions-only) |
| **Exclude emergency** | Route all except 911 | See [Option 3](#option-3-exclude-emergency-extensions) |
| **Internal calls only** | Only internal ext-to-ext | See [Option 4](#option-4-internal-calls-only) |

---

## Option 1: Route ALL Calls Through Stasis

The [basic dialplan setup](./FREEPBX-ARI-CONFIGURATION.md#2%EF%B8%8F%E2%83%A3-configure-custom-dialplan) already routes **trunk calls** through Stasis. To also catch **internal** and **queue** calls, add these contexts to `extensions_custom.conf`:

```ini
; ============================================
; CATCH ALL INTERNAL CALLS
; ============================================
[from-internal-custom]
exten => _X.,1,NoOp(ARI: Internal call from ${CALLERID(num)} to ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()

; ============================================
; CATCH QUEUE CALLS (if using call queues)
; ============================================
[from-queue-custom]
exten => _X.,1,NoOp(ARI: Queue call to ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()
```

Reload and verify:
```bash
asterisk -rx "dialplan reload"
asterisk -rx "dialplan show from-internal-custom"
```

**Result**: Combined with the basic setup, ALL calls go through your AriLink server:

| Call Type | Example | Will Route? |
|-----------|---------|-------------|
| **Internal: Ext → Ext** | 101 calls 102 | ✅ YES |
| **Incoming: External → Ext** | Outside → 101 | ✅ YES (from basic setup) |
| **Outgoing: Ext → External** | 101 → Outside | ✅ YES |
| **Queue calls** | Caller → Queue | ✅ YES |

---

## Option 2: Specific Extensions Only

Route only certain extensions (e.g., customer service extensions 101-110):

```ini
[from-internal-custom]
; Route extensions 101-110 through Stasis
exten => _10[0-9],1,NoOp(ARI: Customer service extension ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()

; Route extensions 201-210 through Stasis
exten => _20[0-9],1,NoOp(ARI: Sales extension ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()

; All other extensions use normal FreePBX routing
```

**Pattern Matching:**
- `_10[0-9]` = Extensions 100-109
- `_1XX` = Extensions 100-199
- `_X.` = Any extension (catch-all)

---

## Option 3: Exclude Emergency Extensions

Route all calls EXCEPT emergency numbers:

```ini
[from-internal-custom]
; Don't intercept emergency calls
exten => 911,1,NoOp(Emergency - skip Stasis)
 same => n,Goto(from-internal,911,1)

; Don't intercept operator
exten => 0,1,NoOp(Operator - skip Stasis)
 same => n,Goto(from-internal,0,1)

; Route everything else through Stasis
exten => _X.,1,NoOp(ARI: Normal call from ${CALLERID(num)} to ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()
```

⚠️ **Order matters!** Specific rules must come BEFORE catch-all patterns.

---

## Option 4: Internal Calls Only

Only transcribe internal extension-to-extension calls:

```ini
[from-internal-custom]
; Only intercept 3-digit internal extensions
exten => _XXX,1,NoOp(ARI: Internal call from ${CALLERID(num)} to ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()

; External calls (10+ digits) use normal routing
; They won't match _XXX pattern
```

---

## Advanced: Conditional Routing

Route based on caller ID, time of day, or other conditions:

```ini
[from-internal-custom]
; Route VIP customers (based on caller ID)
exten => _X.,1,GotoIf($[${CALLERID(num)} = 5551234567]?vip:normal)
 same => n(vip),NoOp(VIP caller - priority routing)
 same => n,Stasis(stasis-app-vip,${EXTEN},${CALLERID(num)})
 same => n,Hangup()
 same => n(normal),NoOp(Normal caller)
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()

; Route based on time of day
exten => 100,1,GotoIfTime(9:00-17:00,mon-fri,*,*?business_hours:after_hours)
 same => n(business_hours),Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()
 same => n(after_hours),Playback(office-closed)
 same => n,Hangup()
```

## Testing

1. **Reload dialplan**: `asterisk -rx "dialplan reload"`
2. **Make ANY call** between extensions
3. **Check ARI server logs** - you should see:
   ```
   Channel PJSIP/xxx-xxx just entered the Stasis application
   [SessionManager] Created session call-xxx-xxx
   ```

---

## 🐛 Troubleshooting

### Problem: Calls Don't Route Through Stasis

**Symptoms:**
- No session created in ARI server logs
- Call works but doesn't trigger transcription

**Debug Steps:**

```bash
# Enable verbose logging
asterisk -rx "core set verbose 5"
asterisk -rx "core set debug 5"

# Watch live console
asterisk -rvvv

# Make a test call and watch the output
```

**Look for:**
- ✅ `Executing [XXX@from-internal-custom:1]` → Good! Custom context is being used
- ❌ `Executing [XXX@from-internal:1]` → Bad! Custom context is NOT being used

**Fix:**
1. Ensure you saved the configuration in FreePBX
2. Run `asterisk -rx "dialplan reload"`
3. Check that your extension pattern matches (e.g., `_X.` for any extension)

---

### Problem: Some Calls Work, Others Don't

**Check Pattern Matching:**

```bash
# Show which pattern will match an extension
asterisk -rx "dialplan show from-internal-custom"
```

**Common Issues:**
- Pattern `_XXX` only matches 3-digit extensions (won't match external numbers)
- Pattern `_1NXXNXXXXXX` only matches US 11-digit numbers
- Use `_X.` to match ANY extension/number

---

### Problem: Emergency Calls (911) Are Blocked

**Fix:** Add emergency bypass BEFORE catch-all:

```ini
[from-internal-custom]
; Emergency bypass - MUST come first
exten => 911,1,NoOp(Emergency bypass)
 same => n,Goto(from-internal,911,1)

; Then catch-all
exten => _X.,1,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()
```

---

### Problem: Calls Hang Up Immediately

Ensure your AriLink server is running and connected to FreePBX ARI. See [FREEPBX-ARI-CONFIGURATION.md Troubleshooting](./FREEPBX-ARI-CONFIGURATION.md#-troubleshooting) for ARI connection issues.

---

## 📋 Reference: Dialplan Patterns

| Pattern | Matches | Example |
|---------|---------|---------|
| `_X.` | Any extension | 100, 911, 15551234567 |
| `_XXX` | Exactly 3 digits | 100, 101, 999 |
| `_XXXX` | Exactly 4 digits | 1000, 2001 |
| `_1NXXXXXXXXX` | US/Canada numbers | 15551234567 |
| `_10[0-9]` | 100-109 | 100, 101, ..., 109 |
| `_1XX` | 100-199 | Any extension 100-199 |
| `_[2-5]XX` | 200-599 | 200, 301, 499 |
| `911` | Exact match | Only 911 |

**Special Characters:**
- `X` = Any digit (0-9)
- `N` = Digit 2-9
- `Z` = Digit 1-9
- `.` = One or more of previous digit
- `!` = Zero or more of previous digit
- `[0-9]` = Range

---

## 💡 Best Practices

1. **Always exclude emergency numbers** (911, 112, etc.)
2. **Test thoroughly** before deploying to production
3. **Use specific patterns** when possible (faster matching)
4. **Document your dialplan** with comments
5. **Keep backups** of working configurations
6. **Monitor ARI server logs** for issues

---

## 📚 Related Documentation

- [FreePBX ARI Configuration](FREEPBX-ARI-CONFIGURATION.md) - ARI setup, basic dialplan, NAT, firewall
- [3CX Integration Guide](3CX-INTEGRATION.md) - 3CX trunk and routing configuration
- [FreePBX Installation Guide](freepbx-setup.md) - Initial FreePBX installation
- [Dialplan Patterns](https://wiki.asterisk.org/wiki/display/AST/Pattern+Matching) - Official Asterisk pattern matching reference

---

**Need help?** Check the [FreePBX community forums](https://community.freepbx.org/) or [Asterisk documentation](https://wiki.asterisk.org/).
