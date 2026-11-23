"use client";

import dynamic from "next/dynamic";

export const BarcodeCameraScannerLazy = dynamic(
  () =>
    import("@/components/barcode-camera-scanner").then(
      (module) => module.BarcodeCameraScanner
    ),
  { ssr: false }
);
