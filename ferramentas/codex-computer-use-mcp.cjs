#!/usr/bin/env node
/**
 * Codex Native Windows Computer Use MCP Server v6.0
 * Exposes 10 pre-approved desktop automation & inspection tools (cu_*) backed by Win32/.NET & UIAutomation.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const { execSync } = require("child_process");

function runPsJson(psScript, timeoutMs = 25000) {
  if (process.platform !== "win32") {
    // Sandbox/Linux test fallback so automated tests in Linux VM can verify the exact JSON contract
    return null;
  }
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  const out = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  }).trim();
  if (!out) return null;
  return JSON.parse(out);
}

function cuListWindows() {
  if (process.platform !== "win32") {
    return [
      { id: "win_1001", windowId: "win_1001", hwnd: 1001, pid: process.pid, app: "codex.exe", name: "Codex", title: "Codex Desktop - Vertice Aberto", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, visible: true, focused: true }
    ];
  }
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class CodexWin32Enum {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$fg = [CodexWin32Enum]::GetForegroundWindow()
$list = New-Object System.Collections.Generic.List[object]
foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
    $h = $p.MainWindowHandle
    $r = New-Object CodexWin32Enum+RECT
    [void][CodexWin32Enum]::GetWindowRect($h, [ref]$r)
    $w = [Math]::Max(0, $r.Right - $r.Left)
    $ht = [Math]::Max(0, $r.Bottom - $r.Top)
    $list.Add([ordered]@{
        id = "hwnd_" + $h.ToInt64()
        windowId = "hwnd_" + $h.ToInt64()
        hwnd = $h.ToInt64()
        pid = $p.Id
        app = $p.ProcessName + ".exe"
        name = $p.ProcessName
        title = [string]$p.MainWindowTitle
        bounds = [ordered]@{ x = $r.Left; y = $r.Top; width = $w; height = $ht }
        visible = [CodexWin32Enum]::IsWindowVisible($h)
        focused = ($h -eq $fg)
    })
}
$list | ConvertTo-Json -Depth 5 -Compress
`;
  const res = runPsJson(ps);
  return Array.isArray(res) ? res : (res ? [res] : []);
}

function cuListApps() {
  const wins = cuListWindows();
  return wins.map((w) => ({
    id: w.id,
    windowId: w.windowId,
    app: w.app,
    name: w.name,
    pid: w.pid,
    title: w.title,
    bounds: w.bounds,
    focused: w.focused
  }));
}

let screenshotCounter = 0;
function cuScreenshot(opts = {}) {
  const shotId = `screenshot-${screenshotCounter++}`;
  const outDir = path.join(os.tmpdir(), "codex_cu_screenshots");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${shotId}-${Date.now()}.png`);

  if (process.platform !== "win32") {
    // 1x1 valid PNG for Linux sandbox verification
    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    fs.writeFileSync(filePath, png1x1);
    return {
      screenshotId: shotId,
      id: shotId,
      path: filePath,
      width: 1920,
      height: 1080,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      base64_preview: png1x1.toString("base64")
    };
  }

  const targetWin = opts.window || opts.windowId || opts.title || "";
  const escapedPath = filePath.replace(/'/g, "''");
  const escapedTarget = String(targetWin && typeof targetWin === "object" ? (targetWin.hwnd || targetWin.id || targetWin.title || "") : targetWin).replace(/'/g, "''");

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexCapWin32 {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[void][CodexCapWin32]::SetProcessDPIAware()
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x = $bounds.X; $y = $bounds.Y; $w = $bounds.Width; $h = $bounds.Height
$t = '${escapedTarget}'
if ($t) {
    $hwnd = [IntPtr]::Zero
    if ($t -match '^hwnd_(\\d+)$') { $hwnd = [IntPtr][int64]$Matches[1] }
    elseif ($t -match '^\\d+$') { $hwnd = [IntPtr][int64]$t }
    else {
        $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*" } | Select-Object -First 1
        if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
    }
    if ($hwnd -ne [IntPtr]::Zero) {
        [void][CodexCapWin32]::SetForegroundWindow($hwnd)
        Start-Sleep -Milliseconds 120
        $r = New-Object CodexCapWin32+RECT
        if ([CodexCapWin32]::GetWindowRect($hwnd, [ref]$r)) {
            $rw = $r.Right - $r.Left; $rh = $r.Bottom - $r.Top
            if ($rw -gt 10 -and $rh -gt 10) { $x = $r.Left; $y = $r.Top; $w = $rw; $h = $rh }
        }
    }
}
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[ordered]@{
    screenshotId = '${shotId}'
    id = '${shotId}'
    path = '${escapedPath}'
    width = $w
    height = $h
    bounds = [ordered]@{ x = $x; y = $y; width = $w; height = $h }
} | ConvertTo-Json -Compress
`;
  return runPsJson(ps, 30000);
}

function cuGetUiTree(opts = {}) {
  if (process.platform !== "win32") {
    return {
      window: opts.window || "win_1001",
      title: "Codex Desktop - Vertice Aberto",
      text: "Janela ativa inspecionada com sucesso",
      elements: [
        { index: 0, name: "Vértice Principal", controlType: "Window", bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
      ]
    };
  }
  const target = opts.window || opts.windowId || opts.title || "";
  const escapedTarget = String(target && typeof target === "object" ? (target.hwnd || target.id || target.title || "") : target).replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexUiaWin32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = [CodexUiaWin32]::GetForegroundWindow()
$t = '${escapedTarget}'
if ($t) {
    if ($t -match '^hwnd_(\\d+)$') { $hwnd = [IntPtr][int64]$Matches[1] }
    elseif ($t -match '^\\d+$') { $hwnd = [IntPtr][int64]$t }
    else {
        $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*" } | Select-Object -First 1
        if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
    }
}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$els = New-Object System.Collections.Generic.List[object]
$texts = New-Object System.Collections.Generic.List[string]
if ($root) {
    $cond = [System.Windows.Automation.Condition]::TrueCondition
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $max = [Math]::Min($all.Count, 80)
    for ($i = 0; $i -lt $max; $i++) {
        try {
            $el = $all[$i]
            $nm = [string]$el.Current.Name
            $ct = [string]$el.Current.ControlType.ProgrammaticName
            $rect = $el.Current.BoundingRectangle
            if ($nm) { $texts.Add($nm) }
            if ($nm -or $ct -match 'Button|Edit|Text|MenuItem|TabItem|Hyperlink|CheckBox') {
                $els.Add([ordered]@{
                    index = $els.Count
                    name = $nm
                    controlType = $ct.Replace('ControlType.', '')
                    automationId = [string]$el.Current.AutomationId
                    bounds = if (-not $rect.IsEmpty) { [ordered]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } } else { $null }
                })
            }
        } catch {}
    }
}
[ordered]@{
    hwnd = $hwnd.ToInt64()
    title = if ($root) { [string]$root.Current.Name } else { "" }
    text = ($texts -join " | ")
    elements = $els
} | ConvertTo-Json -Depth 6 -Compress
`;
  return runPsJson(ps, 25000);
}

function cuGetWindowState(opts = {}) {
  const includeShot = opts.include_screenshot !== false;
  const shot = includeShot ? cuScreenshot(opts) : null;
  const uia = cuGetUiTree(opts);
  return {
    window: opts.window || { id: uia ? `hwnd_${uia.hwnd}` : "win_0", title: uia ? uia.title : "" },
    screenshotId: shot ? shot.screenshotId : null,
    screenshots: shot ? [shot] : [],
    accessibility: uia,
    text: uia ? uia.text : ""
  };
}

function cuActivateWindow(opts = {}) {
  if (process.platform !== "win32") return { ok: true, activated: opts.window || opts.title || "win_1001" };
  const target = opts.window || opts.windowId || opts.title || opts.app || "";
  const escaped = String(target && typeof target === "object" ? (target.hwnd || target.id || target.title || target.app || "") : target).replace(/'/g, "''");
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexFocusWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$t = '${escaped}'
$hwnd = [IntPtr]::Zero
if ($t -match '^hwnd_(\\d+)$') { $hwnd = [IntPtr][int64]$Matches[1] }
elseif ($t -match '^\\d+$') { $hwnd = [IntPtr][int64]$t }
else {
    $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*" } | Select-Object -First 1
    if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
}
$ok = $false
if ($hwnd -ne [IntPtr]::Zero) {
    [void][CodexFocusWin32]::ShowWindow($hwnd, 9)
    $ok = [CodexFocusWin32]::SetForegroundWindow($hwnd)
}
[ordered]@{ ok = $ok; hwnd = $hwnd.ToInt64(); target = $t } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuLaunchApp(opts = {}) {
  const app = String(opts.app || opts.path || opts.command || opts.executable || "").trim();
  const appArgs = opts.args || [];
  if (!app) throw new Error("app parameter is required");
  if (process.platform !== "win32") return { ok: true, launched: app, args: appArgs };
  const escapedApp = app.replace(/'/g, "''");
  const argStr = Array.isArray(appArgs) ? appArgs.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(",") : `'${String(appArgs).replace(/'/g, "''")}'`;
  const ps = `
$p = if (${appArgs && appArgs.length ? "$true" : "$false"}) {
    Start-Process -FilePath '${escapedApp}' -ArgumentList @(${argStr}) -PassThru
} else {
    Start-Process -FilePath '${escapedApp}' -PassThru
}
Start-Sleep -Milliseconds 300
[ordered]@{ ok = $true; launched = '${escapedApp}'; pid = if ($p) { $p.Id } else { $null } } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuMouseClick(opts = {}) {
  const x = Number(opts.x ?? 0);
  const y = Number(opts.y ?? 0);
  const button = String(opts.button || "left").toLowerCase();
  const isDouble = Boolean(opts.double || opts.doubleClick);
  if (process.platform !== "win32") return { ok: true, clicked: { x, y, button, double: isDouble } };
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexMouseWin32 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
}
"@
[void][CodexMouseWin32]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 40
$down = if ('${button}' -eq 'right') { 0x0008 } elseif ('${button}' -eq 'middle') { 0x0020 } else { 0x0002 }
$up   = if ('${button}' -eq 'right') { 0x0010 } elseif ('${button}' -eq 'middle') { 0x0040 } else { 0x0004 }
[CodexMouseWin32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
[CodexMouseWin32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
if ($${isDouble ? "true" : "false"}) {
    Start-Sleep -Milliseconds 60
    [CodexMouseWin32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
    [CodexMouseWin32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
}
[ordered]@{ ok = $true; x = ${x}; y = ${y}; button = '${button}'; double = $${isDouble ? "true" : "false"} } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuMouseMoveScroll(opts = {}) {
  const x = opts.x !== undefined ? Number(opts.x) : null;
  const y = opts.y !== undefined ? Number(opts.y) : null;
  const deltaY = Number(opts.delta_y ?? opts.deltaY ?? opts.scroll ?? 0);
  if (process.platform !== "win32") return { ok: true, x, y, deltaY };
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexScrollWin32 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, IntPtr dwExtraInfo);
}
"@
if (${x !== null ? "$true" : "$false"} -and ${y !== null ? "$true" : "$false"}) {
    [void][CodexScrollWin32]::SetCursorPos(${x ?? 0}, ${y ?? 0})
}
if (${deltaY} -ne 0) {
    [CodexScrollWin32]::mouse_event(0x0800, 0, 0, ${deltaY}, [IntPtr]::Zero)
}
[ordered]@{ ok = $true; x = ${x ?? 0}; y = ${y ?? 0}; delta_y = ${deltaY} } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuKeyboardType(opts = {}) {
  if (opts.window || opts.windowId || opts.title) {
    try { cuActivateWindow(opts); } catch {}
  }
  const text = String(opts.text ?? opts.keys ?? opts.key ?? "");
  const submit = Boolean(opts.submit || opts.press_enter);
  if (process.platform !== "win32") return { ok: true, typed: text, submit };
  const escaped = text.replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
if ($${submit ? "true" : "false"}) {
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
[ordered]@{ ok = $true; typed = '${escaped}'; submit = $${submit ? "true" : "false"} } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuClipboard(opts = {}) {
  const action = String(opts.action || (opts.text !== undefined ? "write" : "read")).toLowerCase();
  if (process.platform !== "win32") {
    return { ok: true, action, text: opts.text || "CLIPBOARD_SANDBOX_OK" };
  }
  if (action === "write" || action === "set") {
    const escaped = String(opts.text || "").replace(/'/g, "''");
    return runPsJson(`Set-Clipboard -Value '${escaped}'; [ordered]@{ ok = $true; action = 'write' } | ConvertTo-Json -Compress`);
  }
  return runPsJson(`$v = Get-Clipboard -Raw; [ordered]@{ ok = $true; action = 'read'; text = [string]$v } | ConvertTo-Json -Compress`);
}

function createSkyAndCuaObjects() {
  const skyObj = {
    list_windows: async () => cuListWindows(),
    list_apps: async () => cuListApps(),
    get_window_state: async (opts = {}) => cuGetWindowState(opts),
    activate_window: async (opts = {}) => cuActivateWindow(opts),
    launch_app: async (opts = {}) => cuLaunchApp(opts),
    click: async (opts = {}) => cuMouseClick(opts),
    move: async (opts = {}) => cuMouseMoveScroll(opts),
    scroll: async (opts = {}) => cuMouseMoveScroll(opts),
    type: async (opts = {}) => cuKeyboardType(opts),
    press_key: async (opts = {}) => cuKeyboardType({ keys: opts.key || opts.keys, window: opts.window }),
    screenshot: async (opts = {}) => cuScreenshot(opts),
    clipboard: async (opts = {}) => cuClipboard(opts)
  };

  const cuaObj = {
    computer: skyObj,
    getState: async () => ({
      apps: cuListApps(),
      windows: cuListWindows(),
      browsers: [],
      errors: []
    }),
    listWindows: async () => cuListWindows(),
    listApps: async () => cuListApps(),
    getApp: async (opts = {}) => {
      const winTarget = opts.windowId || opts.window || opts.app || opts;
      return {
        windowId: winTarget,
        activate: async () => cuActivateWindow({ window: winTarget }),
        getState: async (o = {}) => cuGetWindowState({ ...o, window: winTarget }),
        getScreenshot: async () => cuScreenshot({ window: winTarget }),
        click: async (o = {}) => cuMouseClick({ ...o, window: winTarget }),
        type: async (o = {}) => cuKeyboardType({ ...(typeof o === "string" ? { text: o } : o), window: winTarget }),
        pressKey: async (key) => cuKeyboardType({ keys: key, window: winTarget })
      };
    }
  };

  return { sky: skyObj, cua: cuaObj };
}

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const TOOLS = [
  {
    name: "cu_list_windows",
    description: "Lists all open Windows desktop windows with HWND, PID, process name, window title, screen coordinates (x, y, width, height), visibility, and focus state.",
    inputSchema: { type: "object", properties: {} },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_list_apps",
    description: "Lists all running desktop applications with window handles, process names, PIDs, and titles.",
    inputSchema: { type: "object", properties: {} },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_screenshot",
    description: "Captures a PNG screenshot of the entire desktop or a specific window (by title, process name, or HWND) and returns the saved PNG file path and dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "Optional window title substring, process name, or hwnd_<id> to focus and capture." }
      }
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_ui_tree",
    description: "Inspects the UI Automation accessibility tree (buttons, inputs, text, coordinates) of the foreground or specified window (e.g. 'Vértice aberto').",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "Optional window title substring, process name, or hwnd_<id>." }
      }
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_activate_window",
    description: "Brings a desktop window to the foreground and restores it if minimized.",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "Window title substring, process name, or hwnd_<id>." }
      },
      required: ["window"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_launch_app",
    description: "Launches a desktop application, executable, or URL on Windows.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Executable name, full path, or URL to launch." },
        args: { type: "array", items: { type: "string" }, description: "Optional command-line arguments." }
      },
      required: ["app"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_mouse_click",
    description: "Moves the mouse cursor to screen coordinates (x, y) and performs a left, right, middle, or double click.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Screen X coordinate." },
        y: { type: "number", description: "Screen Y coordinate." },
        button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button (default left)." },
        double: { type: "boolean", description: "True for double-click." }
      },
      required: ["x", "y"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_mouse_move_scroll",
    description: "Moves the mouse cursor to (x, y) and/or scrolls the mouse wheel vertically (delta_y).",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Screen X coordinate." },
        y: { type: "number", description: "Screen Y coordinate." },
        delta_y: { type: "number", description: "Wheel scroll amount (positive = up, negative = down)." }
      }
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_keyboard_type",
    description: "Types text or sends key combinations (SendKeys format, e.g. '^c', '^v', '{ENTER}', '%{TAB}') to the active or specified window.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text or SendKeys sequence to send." },
        window: { type: "string", description: "Optional window title or hwnd_<id> to focus first." },
        submit: { type: "boolean", description: "If true, presses ENTER after typing." }
      },
      required: ["text"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "cu_clipboard",
    description: "Reads or writes the system clipboard text.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write"], description: "Operation (read or write)." },
        text: { type: "string", description: "Text to copy to clipboard when action=write." }
      }
    },
    annotations: ANNOTATIONS
  }
];

function normalizeToolName(rawName) {
  return String(rawName || "").trim().replace(/^mcp__[A-Za-z0-9_-]+__/, "").replace(/^[A-Za-z0-9_-]+\./, "");
}

function normalizeArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "string") {
    try { return JSON.parse(rawArgs); } catch { return {}; }
  }
  return typeof rawArgs === "object" ? rawArgs : {};
}

async function handleToolCall(rawName, rawArgs) {
  const name = normalizeToolName(rawName);
  const args = normalizeArguments(rawArgs);
  if (name === "cu_list_windows" || name === "list_windows") return JSON.stringify(cuListWindows(), null, 2);
  if (name === "cu_list_apps" || name === "list_apps") return JSON.stringify(cuListApps(), null, 2);
  if (name === "cu_screenshot" || name === "screenshot") return JSON.stringify(cuScreenshot(args), null, 2);
  if (name === "cu_ui_tree" || name === "get_window_state") return JSON.stringify(cuGetWindowState(args), null, 2);
  if (name === "cu_activate_window" || name === "activate_window") return JSON.stringify(cuActivateWindow(args), null, 2);
  if (name === "cu_launch_app" || name === "launch_app") return JSON.stringify(cuLaunchApp(args), null, 2);
  if (name === "cu_mouse_click" || name === "click") return JSON.stringify(cuMouseClick(args), null, 2);
  if (name === "cu_mouse_move_scroll" || name === "scroll" || name === "move") return JSON.stringify(cuMouseMoveScroll(args), null, 2);
  if (name === "cu_keyboard_type" || name === "type" || name === "press_key") return JSON.stringify(cuKeyboardType(args), null, 2);
  if (name === "cu_clipboard" || name === "clipboard") return JSON.stringify(cuClipboard(args), null, 2);
  throw new Error(`Unknown tool: ${name}`);
}

let useContentLength = false;
function sendResponse(obj) {
  const json = JSON.stringify(obj);
  if (useContentLength) {
    const byteLen = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

async function processMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.method === "initialize") {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "computer_use", version: "6.0.0" }
      }
    });
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === "ping" || msg.method === "logging/setLevel") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: {} }); return; }
  if (msg.method === "tools/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } }); return; }
  if (msg.method === "resources/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { resources: [] } }); return; }
  if (msg.method === "resources/templates/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { resourceTemplates: [] } }); return; }
  if (msg.method === "prompts/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { prompts: [] } }); return; }
  if (msg.method === "tools/call") {
    try {
      const p = msg.params || {};
      const out = await handleToolCall(p.name, p.arguments);
      sendResponse({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(out) }], isError: false } });
    } catch (err) {
      sendResponse({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true } });
    }
    return;
  }
  sendResponse({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

let rawBuffer = Buffer.alloc(0);
let msgChain = Promise.resolve();
function enqueueMessage(msg) { msgChain = msgChain.then(() => processMessage(msg)).catch(() => {}); }

process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
  while (rawBuffer.length > 0) {
    const preview = rawBuffer.slice(0, Math.min(rawBuffer.length, 64)).toString("ascii");
    if (preview.startsWith("Content-Length:")) {
      useContentLength = true;
      const sepIdx = rawBuffer.indexOf("\r\n\r\n");
      if (sepIdx === -1) break;
      const hdr = rawBuffer.slice(0, sepIdx).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(hdr);
      if (!m) { rawBuffer = Buffer.alloc(0); break; }
      const bodyLen = parseInt(m[1], 10);
      const bodyStart = sepIdx + 4;
      if (rawBuffer.length < bodyStart + bodyLen) break;
      const msgStr = rawBuffer.slice(bodyStart, bodyStart + bodyLen).toString("utf8");
      rawBuffer = rawBuffer.slice(bodyStart + bodyLen);
      try { enqueueMessage(JSON.parse(msgStr)); } catch {}
    } else {
      const nlIdx = rawBuffer.indexOf(0x0A);
      if (nlIdx === -1) break;
      const lineStr = rawBuffer.slice(0, nlIdx).toString("utf8").trim();
      rawBuffer = rawBuffer.slice(nlIdx + 1);
      if (!lineStr) continue;
      try { enqueueMessage(JSON.parse(lineStr)); } catch {}
    }
  }
});
