export default function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="music-section-header">
      <div>
        <h2 className="music-section-title">{title}</h2>
        {subtitle ? <p className="music-section-subtitle">{subtitle}</p> : null}
      </div>
      {action || null}
    </div>
  );
}
