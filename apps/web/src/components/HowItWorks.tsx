interface HowItWorksProps {
  bountyBpsLabel: string;
  windowBlocks: number;
}

export function HowItWorks({ bountyBpsLabel, windowBlocks }: HowItWorksProps) {
  return (
    <section className="how panel">
      <div className="how-head">
        <span className="eyebrow"><span className="pip" />The mechanic</span>
        <h2>
          Dumps <span className="accent">→</span> bag <span className="accent">→</span> apes split it
        </h2>
        <p>Three blocks. One direction. Repeat forever.</p>
      </div>

      <div className="steps">
        <article className="step">
          <span className="step-emoji" aria-hidden="true">🐋</span>
          <h3>Whale dumps</h3>
          <p>
            Every sell on the v4 pool gets taxed. <strong>{bountyBpsLabel}</strong> of the
            dump is yoinked straight into the bounty contract.
          </p>
        </article>

        <span className="step-arrow" aria-hidden="true">→</span>

        <article className="step">
          <span className="step-emoji" aria-hidden="true">💰</span>
          <h3>Bag arms</h3>
          <p>
            That tax opens a <strong>{windowBlocks}-block</strong> window. The pot just
            sits there glowing, waiting for buyers.
          </p>
        </article>

        <span className="step-arrow" aria-hidden="true">→</span>

        <article className="step">
          <span className="step-emoji" aria-hidden="true">🦍</span>
          <h3>Apes split it</h3>
          <p>
            Buy in the window, claim your <strong>proportional cut</strong>. Bigger bag = bigger split.
            Then the next dump rearms.
          </p>
        </article>
      </div>
    </section>
  );
}
