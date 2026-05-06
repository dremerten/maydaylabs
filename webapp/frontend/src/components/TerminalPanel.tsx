"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

interface Props {
  wsUrl: string | null;
  label: string;
  accentColor?: "cyan" | "teal";
  onDisconnect?: () => void;
  showTitleBar?: boolean;
}

export default function TerminalPanel({ wsUrl, label, accentColor = "cyan", onDisconnect, showTitleBar = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [termReady, setTermReady] = useState(false);

  const accentHex = accentColor === "cyan" ? "#0096c7" : "#2ec4b6";

  // ── Effect 1: initialise xterm.js ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (cancelled || !containerRef.current) return;

      const term = new Terminal({
        theme: {
          background: "#000000",
          foreground: "#ffffff",
          cursor: "#00ff00",
          cursorAccent: "#000000",
          selectionBackground: "#ffffff40",
          black: "#000000",
          brightBlack: "#555555",
          red: "#cc0000",
          brightRed: "#ff5555",
          green: "#00cc00",
          brightGreen: "#55ff55",
          yellow: "#cccc00",
          brightYellow: "#ffff55",
          blue: "#0066cc",
          brightBlue: "#5599ff",
          magenta: "#cc00cc",
          brightMagenta: "#ff55ff",
          cyan: "#00cccc",
          brightCyan: "#55ffff",
          white: "#cccccc",
          brightWhite: "#ffffff",
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);
      fit.fit();
      term.focus();

      xtermRef.current = term;
      fitRef.current = fit;

      const observer = new ResizeObserver(() => fitRef.current?.fit());
      observer.observe(containerRef.current);

      setTermReady(true);

      return () => {
        observer.disconnect();
        term.dispose();
        xtermRef.current = null;
      };
    })();

    return () => { cancelled = true; };
  }, []);

  // ── Effect 2: open WebSocket once both the URL and the terminal are ready ──
  useEffect(() => {
    if (!wsUrl || !termReady || !xtermRef.current) return;
    const term = xtermRef.current;

    term.clear();
    term.write(`\x1b[36m● Connecting…\x1b[0m\r\n`);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      term.write("\x1b[32m● Connected\x1b[0m\r\n\n");
      term.focus();
      if (fitRef.current) {
        const dims = fitRef.current.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data);
      }
    };

    ws.onclose = (e) => {
      if (e.code === 4404) {
        term.write("\r\n\x1b[31m● Session not found or expired — start a new session from the Play page\x1b[0m\r\n");
      } else {
        term.write("\r\n\x1b[33m● Session ended\x1b[0m\r\n");
      }
      onDisconnect?.();
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m● Connection error\x1b[0m\r\n");
    };

    const inputDispose = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const resizeDispose = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    return () => {
      inputDispose.dispose();
      resizeDispose.dispose();
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl, termReady, onDisconnect]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden rounded-lg border"
      style={{ borderColor: `${accentHex}40`, background: "#000000" }}
      onClick={() => xtermRef.current?.focus()}
    >
      {showTitleBar && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
          style={{ borderColor: `${accentHex}30`, background: "#0a0a0a" }}
        >
          <div className="w-2 h-2 rounded-full animate-pulse-slow" style={{ backgroundColor: accentHex }} />
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: accentHex }}>{label}</span>
          <div className="ml-auto flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-600/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-600/70" />
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <div ref={containerRef} className="xterm-container w-full h-full" />
      </div>
    </div>
  );
}
