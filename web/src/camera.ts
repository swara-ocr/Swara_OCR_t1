import { CONFIG } from "./config";
import type { Mode } from "./guidance";

export interface Camera {
  stream: MediaStream;
  mode: Mode;
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput");
}

/** Opens the rear camera by default, or a chosen device. */
export async function openCamera(deviceId?: string): Promise<Camera> {
  const video: MediaTrackConstraints = {
    width: { ideal: CONFIG.capture.idealWidth },
    height: { ideal: CONFIG.capture.idealHeight },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: "environment" };
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const track = stream.getVideoTracks()[0];
  const facing = track.getSettings().facingMode;
  const label = track.label.toLowerCase();
  const rear = facing === "environment" || /back|rear|environment/.test(label);
  return { stream, mode: rear ? "phone" : "webcam" };
}

export function closeCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Takes the photo from the video at its full stream resolution. */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}
