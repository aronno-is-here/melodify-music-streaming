export default function EmptyState({ icon = 'fa-music', title, detail }) {
  return (
    <div className="music-empty-state" role="status" aria-live="polite">
      <i className={`fa-solid ${icon}`} aria-hidden="true" style={{ fontSize: 24, marginBottom: 10 }}></i>
      <div style={{ fontWeight: 700 }}>{title}</div>
      {detail ? <div style={{ marginTop: 4, fontSize: 13 }}>{detail}</div> : null}
    </div>
  );
}
