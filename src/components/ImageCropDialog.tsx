"use client";

import {
  KeyboardEvent,
  PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Crop, Move, RotateCcw, ZoomIn } from "lucide-react";
import styles from "./Marketplace.module.css";

type CropOffset = {
  x: number;
  y: number;
};

type ImageSize = {
  width: number;
  height: number;
};

type ImageCropDialogProps = {
  file: File;
  aspectRatio: number;
  title: string;
  outputWidth: number;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
};

const maximumZoom = 3;

function renderedImageSize(viewport: ImageSize, image: ImageSize, zoom: number): ImageSize {
  const viewportRatio = viewport.width / viewport.height;
  const imageRatio = image.width / image.height;

  if (imageRatio > viewportRatio) {
    const height = viewport.height * zoom;
    return { width: height * imageRatio, height };
  }

  const width = viewport.width * zoom;
  return { width, height: width / imageRatio };
}

function constrainOffset(offset: CropOffset, viewport: ImageSize, image: ImageSize, zoom: number): CropOffset {
  const rendered = renderedImageSize(viewport, image, zoom);
  const maximumX = Math.max(0, (rendered.width - viewport.width) / 2);
  const maximumY = Math.max(0, (rendered.height - viewport.height) / 2);

  return {
    x: Math.min(maximumX, Math.max(-maximumX, offset.x)),
    y: Math.min(maximumY, Math.max(-maximumY, offset.y)),
  };
}

function croppedFileName(originalName: string) {
  const baseName = originalName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${baseName || "profile-photo"}-cropped.jpg`;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser could not prepare the cropped image."));
      },
      "image/jpeg",
      0.9,
    );
  });
}

export function ImageCropDialog({
  file,
  aspectRatio,
  title,
  outputWidth,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const [source, setSource] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const onCancelRef = useRef(onCancel);
  const processingRef = useRef(processing);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    onCancelRef.current = onCancel;
    processingRef.current = processing;
  }, [onCancel, processing]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleDialogKeys(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !processingRef.current) {
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
    };
  }, []);

  function viewportSize(): ImageSize | null {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return { width: bounds.width, height: bounds.height };
  }

  function moveImage(nextOffset: CropOffset, nextZoom = zoom) {
    const viewport = viewportSize();
    if (!viewport || !imageSize) return;
    setOffset(constrainOffset(nextOffset, viewport, imageSize, nextZoom));
  }

  function updateZoom(nextZoom: number) {
    const constrainedZoom = Math.min(maximumZoom, Math.max(1, nextZoom));
    setZoom(constrainedZoom);
    moveImage(offset, constrainedZoom);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!imageSize || processing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const movement = { x: event.clientX - drag.x, y: event.clientY - drag.y };
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    moveImage({ x: offset.x + movement.x, y: offset.y + movement.y });
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function handleCropKeys(event: KeyboardEvent<HTMLDivElement>) {
    const amount = event.shiftKey ? 1 : 10;
    const movement: Record<string, CropOffset> = {
      ArrowLeft: { x: amount, y: 0 },
      ArrowRight: { x: -amount, y: 0 },
      ArrowUp: { x: 0, y: amount },
      ArrowDown: { x: 0, y: -amount },
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    moveImage({ x: offset.x + delta.x, y: offset.y + delta.y });
  }

  function resetCrop() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  async function createCrop() {
    const viewport = viewportSize();
    const image = imageRef.current;
    if (!viewport || !image || !imageSize) {
      setError("The image is still loading. Please try again.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const rendered = renderedImageSize(viewport, imageSize, zoom);
      const pixelsPerDisplayPixel = imageSize.width / rendered.width;
      const imageLeft = (viewport.width - rendered.width) / 2 + offset.x;
      const imageTop = (viewport.height - rendered.height) / 2 + offset.y;
      const sourceX = -imageLeft * pixelsPerDisplayPixel;
      const sourceY = -imageTop * pixelsPerDisplayPixel;
      const sourceWidth = viewport.width * pixelsPerDisplayPixel;
      const sourceHeight = viewport.height * pixelsPerDisplayPixel;
      const requestedHeight = Math.round(outputWidth / aspectRatio);
      const outputScale = Math.min(1, outputWidth / sourceWidth, requestedHeight / sourceHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
      canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));

      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the cropped image.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const blob = await canvasBlob(canvas);
      const croppedFile = new File([blob], croppedFileName(file.name), {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      await onConfirm(croppedFile);
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "The cropped image could not be uploaded.");
      setProcessing(false);
    }
  }

  const imageRatio = imageSize ? imageSize.width / imageSize.height : 1;
  const imageStyle = imageRatio > aspectRatio
    ? { height: `${zoom * 100}%`, width: "auto" }
    : { width: `${zoom * 100}%`, height: "auto" };

  return (
    <div className={styles.cropBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !processing) onCancel();
    }}>
      <section
        ref={dialogRef}
        className={styles.cropDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-crop-title"
        aria-describedby="image-crop-help"
      >
        <div className={styles.cropHeader}>
          <div>
            <p className={styles.cropEyebrow}><Crop size={15} aria-hidden="true" /> Photo editor</p>
            <h2 id="image-crop-title">{title}</h2>
          </div>
          <button ref={closeButtonRef} className={styles.cropCloseButton} type="button" disabled={processing} onClick={onCancel} aria-label="Close photo editor">Close</button>
        </div>

        <div
          ref={viewportRef}
          className={styles.cropViewport}
          style={{ aspectRatio, width: `min(100%, ${54 * aspectRatio}dvh)` }}
          tabIndex={0}
          role="application"
          aria-label="Crop preview. Drag the photo or use the arrow keys to reposition it."
          onKeyDown={handleCropKeys}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        >
          {source ? (
            // This local object URL is selected by the user and is not available to Next Image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imageRef}
              className={styles.cropImage}
              src={source}
              alt=""
              draggable={false}
              style={{
                ...imageStyle,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
              onLoad={(event) => {
                setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                setError(null);
              }}
              onError={() => setError("This image could not be opened. Try a different JPG, PNG, or WebP file.")}
            />
          ) : null}
          <span className={styles.cropGrid} aria-hidden="true" />
          {!imageSize && !error ? <span className={styles.cropLoading}>Preparing photo...</span> : null}
        </div>

        <p className={styles.cropHelp} id="image-crop-help"><Move size={16} aria-hidden="true" /> Drag the photo to frame it. Use the slider to zoom in.</p>
        <div className={styles.cropControls}>
          <label className={styles.cropZoom}>
            <ZoomIn size={18} aria-hidden="true" />
            <span>Zoom</span>
            <input
              type="range"
              min="1"
              max={maximumZoom}
              step="0.01"
              value={zoom}
              disabled={!imageSize || processing}
              onChange={(event) => updateZoom(Number(event.target.value))}
            />
          </label>
          <button className={styles.cropResetButton} type="button" disabled={!imageSize || processing} onClick={resetCrop}>
            <RotateCcw size={16} aria-hidden="true" /> Reset
          </button>
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={`${styles.buttonRow} ${styles.cropActions}`}>
          <button className={styles.secondaryButton} type="button" disabled={processing} onClick={onCancel}>Cancel</button>
          <button className={styles.button} type="button" disabled={!imageSize || processing} onClick={() => void createCrop()}>
            {processing ? "Uploading..." : "Crop and upload"}
          </button>
        </div>
      </section>
    </div>
  );
}
