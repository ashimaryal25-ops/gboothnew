"use client";

/* eslint-disable @next/next/no-img-element -- Portraits are generated data URLs. */

import type { CardIdentity } from "@/lib/card-schema";
import { getCardTemplate } from "@/lib/card-templates";

interface CardPreviewProps {
  card: CardIdentity;
  photo: string;
}

export function CardPreview({ card, photo }: CardPreviewProps) {
  const template = getCardTemplate(card.colorTheme);
  const traitScores = Object.entries(card.stats)
    .filter(([label]) => label !== "Campus Power")
    .slice(0, 3);
  const campusPower = card.stats["Campus Power"];
  const knownFor = card.description
    .replace(/^known for\s+/i, "")
    .replace(/\.$/, "")
    .trim();
  const formattedKnownFor = knownFor
    ? `${knownFor.charAt(0).toUpperCase()}${knownFor.slice(1)}`
    : "A memorable Gettysburg moment";

  return (
    <article
      className={`gold-card ${template.textClassName}`}
      aria-label={`${card.displayName} Gettysburg College trading card`}
    >
      <img
        src={template.imagePath}
        alt=""
        aria-hidden="true"
        className="gold-card__background"
      />

      <header className="gold-card__header">
        <div className="gold-card__seal" aria-hidden="true">G</div>
        <span className="gold-card__year">1832</span>
        <span className="gold-card__rarity">{card.rarity}</span>
      </header>

      <div className="gold-card__portrait">
        <img
          src={photo}
          alt={`${card.displayName} card portrait`}
          className="h-full w-full object-cover"
        />
      </div>

      <section className="gold-card__identity">
        <h2>{card.displayName}</h2>
        <p>{card.cardTitle}</p>
      </section>

      <section className="gold-card__traits" aria-label="Trait scores">
        {traitScores.map(([label, value]) => (
          <div key={label} className="gold-card__trait">
            <span>{label}</span>
            <div
              className="gold-card__trait-track"
              role="progressbar"
              aria-label={`${label} score`}
              aria-valuemin={60}
              aria-valuemax={99}
              aria-valuenow={value}
            >
              <div style={{ width: `${value}%` }} />
            </div>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="gold-card__power">
        <span>Campus Power</span>
        <strong>{campusPower}</strong>
      </section>

      <section className="gold-card__known">
        <span className="block leading-[8px]">Known For</span>
        <p>{formattedKnownFor}.</p>
      </section>

      <section className="gold-card__ability">
        <span className="block leading-[8px]">Special Ability</span>
        <strong>{card.specialAbility}</strong>
      </section>

      <div className="gold-card__qr">
        <img
          src="/stickers/icl-logo-sticker.png"
          alt="Innovation and Creativity Lab"
        />
      </div>
    </article>
  );
}
