"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorNote, Input } from "./ui";

const FORMATS = [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
];

/** Live camera barcode scanner, with a manual-entry fallback. */
export function BarcodeScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [cameraAvailable] = useState(() => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
  const shownError = cameraAvailable ? error : "Camera access needs HTTPS (or localhost). Type the barcode number instead.";

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let cancelled = false;
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

    if (!cameraAvailable) return;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        videoRef.current!,
        (result, _err, ctl) => {
          if (result && !cancelled) {
            cancelled = true;
            ctl.stop();
            navigator.vibrate?.(60);
            onDetected(result.getText());
          }
        },
      )
      .then((ctl) => {
        controls = ctl;
        if (cancelled) ctl.stop();
      })
      .catch((err: Error) => {
        setError(
          err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow it in your browser settings, or type the number."
            : `Couldn't start the camera (${err.message}).`,
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onDetected, cameraAvailable]);

  return (
    <div className="flex flex-col gap-3">
      {!shownError && (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          <p className="absolute inset-x-0 bottom-3 text-center text-xs text-white/90">Line up the barcode inside the box</p>
        </div>
      )}
      {shownError && <ErrorNote>{shownError}</ErrorNote>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onDetected(manual.trim());
        }}
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          inputMode="numeric"
          placeholder="Or type the barcode number"
        />
        <Button type="submit" disabled={!manual.trim()}>
          Look up
        </Button>
      </form>
    </div>
  );
}
