let heldStream: MediaStream | null = null;

export async function acquireCameraStream(): Promise<MediaStream> {
  const live =
    heldStream?.getVideoTracks().some((track) => track.readyState === "live") ??
    false;
  if (live && heldStream) return heldStream;

  if (heldStream) {
    heldStream.getTracks().forEach((track) => track.stop());
    heldStream = null;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });
  heldStream = stream;
  return stream;
}
