export function SkeletonBlock({ width = '100%', height = '200px', borderRadius = '12px', className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-block ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

export function SkeletonText({ lines = 3, width = '80%', className = '' }) {
  return (
    <div aria-hidden="true" className={`skeleton-text ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: i === lines - 1 ? '60%' : width }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }) {
  return (
    <div aria-hidden="true" className={`skeleton-card ${className}`}>
      <SkeletonBlock height="180px" borderRadius="12px 12px 0 0" />
      <div style={{ padding: '16px' }}>
        <SkeletonBlock width="70%" height="16px" borderRadius="4px" />
        <div style={{ height: '8px' }} />
        <SkeletonBlock width="45%" height="12px" borderRadius="4px" />
      </div>
    </div>
  );
}
