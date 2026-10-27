"use client";

import { DragEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Film, ImagePlus, Link2, Trash2, Upload, Video } from "lucide-react";
import { getMarketplaceClient, type InstructorProfile } from "@/lib/marketplace";
import {
  parseVideoLink,
  providerLabel,
  videoLinkProblem,
  youtubeThumbnail,
  type VideoProvider
} from "@/lib/videoLinks";
import { ImageCropDialog } from "./ImageCropDialog";
import styles from "./Marketplace.module.css";
import editor from "./ProfileEditor.module.css";

export type EditorMedia = {
  id: string;
  media_type: "headshot" | "image" | "welcome_video" | "video";
  storage_path: string | null;
  external_url: string | null;
  embed_provider: VideoProvider | null;
  embed_id: string | null;
  caption: string | null;
  status: string;
  sort_order: number;
};

type CropJob = { file: File; mediaType: "headshot" | "image" };

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const videoTypes = ["video/mp4", "video/webm", "video/quicktime"];
const maxImageBytes = 10 * 1024 * 1024;
const maxVideoBytes = 50 * 1024 * 1024;
const galleryPhotoLimit = 8;
const galleryVideoLimit = 6;

function publicUrl(item: EditorMedia) {
  if (item.external_url) return item.external_url;
  const client = getMarketplaceClient();
  if (!client || !item.storage_path) return "";
  return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
}

function friendlyDbError(message: string) {
  if (/at most|one welcome video|one headshot|Paste a link|copy the full link|must use https/i.test(message)) return message;
  if (/row-level security/i.test(message)) return "Your profile is locked right now, so media can't be changed.";
  return message;
}

export function ProfileMediaManager({
  profile,
  canEdit,
  onMediaChange
}: {
  profile: InstructorProfile;
  canEdit: boolean;
  onMediaChange?: (media: EditorMedia[]) => void;
}) {
  const [media, setMedia] = useState<EditorMedia[]>([]);
  const [cropQueue, setCropQueue] = useState<CropJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [linkAsWelcome, setLinkAsWelcome] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const headshotInput = useRef<HTMLInputElement>(null);
  const welcomeInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client
      .from("profile_media")
      .select("id,media_type,storage_path,external_url,embed_provider,embed_id,caption,status,sort_order")
      .eq("instructor_profile_id", profile.id)
      .neq("status", "rejected")
      .order("sort_order")
      .order("created_at");
    if (loadError) setError(loadError.message);
    const rows = (data as EditorMedia[] | null) ?? [];
    setMedia(rows);
    setCaptions(Object.fromEntries(rows.map((item) => [item.id, item.caption ?? ""])));
    onMediaChange?.(rows);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const headshot = media.find((item) => item.media_type === "headshot");
  const welcome = media.find((item) => item.media_type === "welcome_video");
  const gallery = media.filter((item) => item.media_type === "image" || item.media_type === "video");
  const photoCount = gallery.filter((item) => item.media_type === "image").length;
  const videoCount = gallery.filter((item) => item.media_type === "video").length;

  async function uploadFile(file: File, mediaType: EditorMedia["media_type"], sortOrder: number) {
    const client = getMarketplaceClient();
    if (!client) throw new Error("Uploads are unavailable right now.");
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${profile.account_id}/${profile.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await client.storage.from("instructor-media").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });
    if (uploadError) throw new Error(uploadError.message);
    const { error: metadataError } = await client.from("profile_media").insert({
      instructor_profile_id: profile.id,
      media_type: mediaType,
      storage_path: path,
      mime_type: file.type,
      status: "ready",
      sort_order: Math.min(sortOrder, 99)
    });
    if (metadataError) {
      await client.storage.from("instructor-media").remove([path]);
      throw new Error(friendlyDbError(metadataError.message));
    }
  }

  async function removeItem(item: EditorMedia, reload = true) {
    const client = getMarketplaceClient();
    if (!client) return;
    const { error: metadataError } = await client.from("profile_media").delete().eq("id", item.id);
    if (metadataError) throw new Error(friendlyDbError(metadataError.message));
    if (item.storage_path) await client.storage.from("instructor-media").remove([item.storage_path]);
    if (reload) await load();
  }

  function checkFile(file: File): "image" | "video" | string {
    if (imageTypes.includes(file.type)) return file.size > maxImageBytes ? `${file.name} is larger than 10 MB.` : "image";
    if (videoTypes.includes(file.type)) {
      if (file.type === "video/quicktime") return `${file.name} is a .mov file. Export it as MP4 (on iPhone, share it and choose "Save to Files" as most compatible), then try again.`;
      return file.size > maxVideoBytes ? `${file.name} is larger than 50 MB. Trim it, or post it to Instagram, TikTok, or YouTube and paste the link instead.` : "video";
    }
    return `${file.name} isn't a supported file. Use JPG, PNG, or WebP photos and MP4 videos.`;
  }

  async function addGalleryFiles(files: File[]) {
    if (!canEdit || !files.length) return;
    setError(null);
    setNotice(null);
    const problems: string[] = [];
    const crops: CropJob[] = [];
    const videos: File[] = [];
    let photos = photoCount;
    let vids = videoCount;
    for (const file of files) {
      const kind = checkFile(file);
      if (kind === "image") {
        if (photos >= galleryPhotoLimit) { problems.push(`You can show up to ${galleryPhotoLimit} photos.`); continue; }
        photos += 1;
        crops.push({ file, mediaType: "image" });
      } else if (kind === "video") {
        if (vids >= galleryVideoLimit) { problems.push(`You can show up to ${galleryVideoLimit} videos.`); continue; }
        vids += 1;
        videos.push(file);
      } else problems.push(kind);
    }
    if (problems.length) setError(Array.from(new Set(problems)).join(" "));
    if (videos.length) {
      setBusy(`Uploading ${videos.length === 1 ? "video" : `${videos.length} videos`}...`);
      try {
        let order = gallery.length;
        for (const file of videos) await uploadFile(file, "video", order++);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
      }
      setBusy(null);
      await load();
    }
    if (crops.length) setCropQueue((current) => [...current, ...crops]);
  }

  async function onCropConfirm(file: File) {
    const job = cropQueue[0];
    if (!job) return;
    setBusy("Uploading photo...");
    try {
      if (job.mediaType === "headshot" && headshot) await removeItem(headshot, false);
      await uploadFile(file, job.mediaType, job.mediaType === "headshot" ? 0 : gallery.length);
      await load();
      setCropQueue((current) => current.slice(1));
    } finally {
      setBusy(null);
    }
  }

  async function chooseWelcomeFile(file: File | undefined) {
    if (!file || !canEdit) return;
    const kind = checkFile(file);
    if (kind !== "video") {
      setError(kind === "image" ? "Your welcome video needs to be a video file." : kind);
      return;
    }
    setError(null);
    setBusy("Uploading welcome video...");
    try {
      if (welcome) await removeItem(welcome, false);
      await uploadFile(file, "welcome_video", 0);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    }
    setBusy(null);
    await load();
  }

  async function addLink() {
    const problem = videoLinkProblem(link);
    if (problem || !link.trim()) {
      setError(problem ?? "Paste a video link first.");
      return;
    }
    if (!linkAsWelcome && videoCount >= galleryVideoLimit) {
      setError(`You can show up to ${galleryVideoLimit} videos. Remove one first.`);
      return;
    }
    const client = getMarketplaceClient();
    if (!client) return;
    setError(null);
    setBusy("Adding video...");
    try {
      if (linkAsWelcome && welcome) await removeItem(welcome, false);
      const { error: insertError } = await client.from("profile_media").insert({
        instructor_profile_id: profile.id,
        media_type: linkAsWelcome ? "welcome_video" : "video",
        external_url: link.trim(),
        status: "ready",
        sort_order: linkAsWelcome ? 0 : Math.min(gallery.length, 99)
      });
      if (insertError) throw new Error(friendlyDbError(insertError.message));
      setLink("");
      setLinkAsWelcome(false);
      const parsed = parseVideoLink(link);
      setNotice(parsed ? `${providerLabel(parsed.provider)} video added. Make sure the post is public so clients can watch it.` : null);
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : "That video could not be added.");
    }
    setBusy(null);
    await load();
  }

  async function remove(item: EditorMedia) {
    setBusy("Removing...");
    setError(null);
    try {
      await removeItem(item);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove that item.");
    }
    setBusy(null);
  }

  async function saveOrder(next: EditorMedia[]) {
    const client = getMarketplaceClient();
    if (!client) return;
    setMedia((current) => [...current.filter((item) => item.media_type === "headshot" || item.media_type === "welcome_video"), ...next]);
    const updates = next
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => item.sort_order !== index + 1);
    for (const { item, index } of updates) {
      const { error: updateError } = await client.from("profile_media").update({ sort_order: index + 1 }).eq("id", item.id);
      if (updateError) {
        setError(friendlyDbError(updateError.message));
        break;
      }
    }
    await load();
  }

  function move(id: string, delta: -1 | 1) {
    const index = gallery.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= gallery.length) return;
    const next = [...gallery];
    [next[index], next[target]] = [next[target], next[index]];
    void saveOrder(next);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...gallery];
    const from = next.findIndex((item) => item.id === dragId);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    void saveOrder(next);
  }

  async function saveCaption(item: EditorMedia) {
    const value = (captions[item.id] ?? "").trim();
    if (value === (item.caption ?? "")) return;
    const client = getMarketplaceClient();
    if (!client) return;
    const { error: updateError } = await client.from("profile_media").update({ caption: value || null }).eq("id", item.id);
    if (updateError) setError(friendlyDbError(updateError.message));
    else setMedia((current) => current.map((row) => (row.id === item.id ? { ...row, caption: value || null } : row)));
  }

  function onDropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (dragId) return;
    void addGalleryFiles(Array.from(event.dataTransfer.files));
  }

  const linkProblem = videoLinkProblem(link);
  const linkPreview = link.trim() && !linkProblem ? parseVideoLink(link) : null;

  return (
    <section className={editor.mediaStep} aria-labelledby="step-media">
      <div>
        <h3 id="step-media">Show clients what it&rsquo;s like</h3>
        <p className={styles.help}>Profiles with a welcome video and a few teaching photos get far more inquiries. Paste links from Instagram, TikTok, or YouTube, or upload files.</p>
      </div>

      {busy ? <p className={styles.notice} role="status">{busy}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!canEdit && profile.status === "pending_review" ? <p className={styles.notice}>Photos and videos are locked while your profile is in review.</p> : null}

      <div className={editor.featureRow}>
        <div className={editor.slot}>
          <span className={styles.legend}>Headshot</span>
          <button
            type="button"
            className={`${editor.headshotTile} ${headshot ? "" : editor.emptySlot}`}
            disabled={!canEdit || busy !== null}
            onClick={() => headshotInput.current?.click()}
            aria-label={headshot ? "Replace headshot" : "Add headshot"}
          >
            {headshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={publicUrl(headshot)} alt="Your headshot" />
            ) : (
              <span><ImagePlus size={28} aria-hidden="true" /> Add headshot</span>
            )}
          </button>
          <small className={styles.muted}>{headshot ? "Tap to replace. " : ""}A clear, smiling photo of your face. Required.</small>
          <input
            ref={headshotInput}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const kind = checkFile(file);
              if (kind !== "image") { setError(kind === "video" ? "Your headshot needs to be a photo." : kind); return; }
              setError(null);
              setCropQueue((current) => [...current, { file, mediaType: "headshot" }]);
            }}
          />
        </div>

        <div className={editor.slot}>
          <span className={styles.legend}>Welcome video</span>
          {welcome ? (
            <div className={editor.welcomeTile}>
              <MediaThumb item={welcome} />
              <div className={editor.tileActions}>
                <button type="button" className={editor.textButton} disabled={!canEdit || busy !== null} onClick={() => welcomeInput.current?.click()}>Replace</button>
                <button type="button" className={editor.textButton} disabled={!canEdit || busy !== null} onClick={() => void remove(welcome)}>Remove</button>
              </div>
            </div>
          ) : (
            <button type="button" className={`${editor.welcomeTile} ${editor.emptySlot}`} disabled={!canEdit || busy !== null} onClick={() => welcomeInput.current?.click()}>
              <span><Video size={28} aria-hidden="true" /> Upload a welcome video</span>
            </button>
          )}
          <small className={styles.muted}>30–60 seconds saying hi and what a class with you feels like. Or paste a link below and choose &ldquo;Use as welcome video.&rdquo;</small>
          <input ref={welcomeInput} hidden type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void chooseWelcomeFile(file); }} />
        </div>
      </div>

      <div className={editor.linkBox}>
        <label className={styles.field}>
          <span><Link2 size={14} aria-hidden="true" /> Paste an Instagram, TikTok, or YouTube link</span>
          <div className={editor.inlineAdd}>
            <input
              type="url"
              inputMode="url"
              placeholder="https://www.instagram.com/reel/..."
              value={link}
              disabled={!canEdit}
              onChange={(event) => { setLink(event.target.value); setNotice(null); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addLink(); } }}
            />
            <button type="button" className={styles.button} disabled={!canEdit || busy !== null || !linkPreview} onClick={() => void addLink()}>Add video</button>
          </div>
        </label>
        {link.trim() && linkProblem ? <small className={editor.fieldError}>{linkProblem}</small> : null}
        {linkPreview ? (
          <div className={editor.linkPreviewRow}>
            <span className={`${editor.providerBadge} ${editor[linkPreview.provider]}`}>{providerLabel(linkPreview.provider)}</span>
            <label className={styles.check}><input type="checkbox" checked={linkAsWelcome} onChange={(event) => setLinkAsWelcome(event.target.checked)} /> <span>Use as welcome video</span></label>
          </div>
        ) : null}
      </div>

      <div className={editor.galleryHeader}>
        <span className={styles.legend}>Gallery</span>
        <span className={styles.muted}>{photoCount}/{galleryPhotoLimit} photos · {videoCount}/{galleryVideoLimit} videos · Drag to reorder. The first item leads your gallery.</span>
      </div>

      <div
        className={`${editor.dropZone} ${dragOver ? editor.dropZoneActive : ""}`}
        onDragOver={(event) => { if (!dragId && canEdit) { event.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropFiles}
      >
        <Upload size={22} aria-hidden="true" />
        <p><strong>Drop photos or videos here</strong> or</p>
        <button type="button" className={styles.secondaryButton} disabled={!canEdit || busy !== null} onClick={() => galleryInput.current?.click()}>Choose files</button>
        <small className={styles.muted}>JPG, PNG, or WebP photos up to 10 MB. MP4 videos up to 50 MB. You can pick several at once.</small>
        <input
          ref={galleryInput}
          hidden
          multiple
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addGalleryFiles(files); }}
        />
      </div>

      {gallery.length ? (
        <ol className={editor.galleryGrid}>
          {gallery.map((item, index) => (
            <li
              key={item.id}
              className={`${editor.galleryItem} ${dragId === item.id ? editor.dragging : ""}`}
              draggable={canEdit}
              onDragStart={() => setDragId(item.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => { if (dragId) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropOn(item.id); }}
            >
              <MediaThumb item={item} />
              {index === 0 ? <span className={editor.leadBadge}>First</span> : null}
              <input
                className={editor.captionInput}
                aria-label="Caption"
                maxLength={140}
                placeholder="Add a caption, like “Holiday party, 80 guests”"
                value={captions[item.id] ?? ""}
                disabled={!canEdit}
                onChange={(event) => setCaptions((current) => ({ ...current, [item.id]: event.target.value }))}
                onBlur={() => void saveCaption(item)}
              />
              {canEdit ? (
                <div className={editor.tileActions}>
                  <button type="button" className={editor.iconButton} aria-label="Move earlier" disabled={index === 0 || busy !== null} onClick={() => move(item.id, -1)}><ArrowLeft size={16} aria-hidden="true" /></button>
                  <button type="button" className={editor.iconButton} aria-label="Move later" disabled={index === gallery.length - 1 || busy !== null} onClick={() => move(item.id, 1)}><ArrowRight size={16} aria-hidden="true" /></button>
                  <button type="button" className={editor.iconButton} aria-label="Remove" disabled={busy !== null} onClick={() => void remove(item)}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {cropQueue[0] ? (
        <ImageCropDialog
          key={`${cropQueue[0].file.name}-${cropQueue.length}`}
          file={cropQueue[0].file}
          aspectRatio={cropQueue[0].mediaType === "headshot" ? 1 : 4 / 3}
          title={cropQueue[0].mediaType === "headshot" ? "Crop your headshot" : cropQueue.length > 1 ? `Crop photo (${cropQueue.length} left)` : "Crop your photo"}
          outputWidth={cropQueue[0].mediaType === "headshot" ? 1200 : 1600}
          onCancel={() => setCropQueue((current) => current.slice(1))}
          onConfirm={onCropConfirm}
        />
      ) : null}
    </section>
  );
}

function MediaThumb({ item }: { item: EditorMedia }) {
  const url = publicUrl(item);
  if (item.embed_provider && item.embed_id) {
    return (
      <a className={`${editor.thumb} ${editor.embedThumb}`} href={item.external_url ?? "#"} target="_blank" rel="noopener noreferrer">
        {item.embed_provider === "youtube" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={youtubeThumbnail(item.embed_id)} alt="" />
        ) : <Film size={30} aria-hidden="true" />}
        <span className={`${editor.providerBadge} ${editor[item.embed_provider]}`}>{providerLabel(item.embed_provider)}</span>
      </a>
    );
  }
  if (item.media_type === "video" || item.media_type === "welcome_video") {
    return <video className={editor.thumb} src={url} controls preload="metadata" playsInline />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={editor.thumb} src={url} alt={item.caption || "Teaching photo"} />;
}
