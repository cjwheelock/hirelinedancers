import { articleText, spotlightMediaUrl, type SpotlightContent } from "@/lib/spotlight";
import { embedUrl, isVerticalProvider } from "@/lib/videoLinks";
import { InstructorContactLink } from "./InstructorContactLink";
import styles from "./Spotlight.module.css";

export function SpotlightBody({ content: c, profileId, preview = false }: {
  content: SpotlightContent; profileId: string; preview?: boolean;
}) {
  const name = articleText(c.name);
  const photo = spotlightMediaUrl(c.photo);
  const video = spotlightMediaUrl(c.video);
  const embed = c.video?.provider && c.video.embedId ? embedUrl(c.video.provider, encodeURIComponent(c.video.embedId)) : null;
  const vertical = c.video?.provider && isVerticalProvider(c.video.provider, video);
  return (
    <div className={styles.body}>
      {photo && <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt={articleText(c.photo?.alt || c.photo?.caption || name)} />
        {c.photo?.caption && <figcaption>{articleText(c.photo.caption)}</figcaption>}
      </figure>}
      {c.bio?.split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i}>{articleText(p)}</p>)}
      {c.years != null && c.years > 0 && <p>{name} has {c.years} {c.years === 1 ? "year" : "years"} of teaching experience.</p>}
      {c.highlights.length > 0 && <section>
        <h3>Teaching highlights</h3>
        <ul>{c.highlights.map((item, i) => <li key={i}><strong>{articleText(item.title)}</strong>{item.detail && <>. {articleText(item.detail)}</>}</li>)}</ul>
      </section>}
      {(c.favoriteDance || c.favoriteSong) && <dl>
        {c.favoriteDance && <div><dt>Favorite line dance</dt><dd>{articleText(c.favoriteDance)}</dd></div>}
        {c.favoriteSong && <div><dt>Favorite line dance song</dt><dd>{articleText(c.favoriteSong)}</dd></div>}
      </dl>}
      {(embed || video) && <figure>
        {embed ? <iframe className={vertical ? styles.vertical : undefined} src={embed}
          title={articleText(c.video?.caption || `Video from ${name}`)} loading="lazy" allowFullScreen />
          : <video src={video} controls preload="none" playsInline aria-label={articleText(c.video?.caption || `Video from ${name}`)} />}
        {c.video?.caption && <figcaption>{articleText(c.video.caption)}</figcaption>}
      </figure>}
      {preview ? <span className="button primary">Hire {name}</span> :
        <InstructorContactLink className="button primary" instructorIdentifier={profileId}>Hire {name}</InstructorContactLink>}
    </div>
  );
}
