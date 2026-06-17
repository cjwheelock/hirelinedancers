import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when the public Supabase env vars are present at build time. */
export const supabaseEnabled = Boolean(url && anonKey);

/** Storage bucket that holds instructor headshots and teaching photos. */
export const MEDIA_BUCKET = "instructor-media";

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, anonKey as string)
  : null;

/** Upload a single image to the media bucket and return its public URL. */
export async function uploadImage(file: File, folder: string): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${folder}/${safe}`;
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
