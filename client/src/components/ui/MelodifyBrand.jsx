import Waveform from '../home/Waveform.jsx';

export default function MelodifyBrand({ variant = 'header' }) {
  const footer = variant === 'footer';
  return (
    <span className={footer ? 'melodify-brand melodify-brand--footer' : 'melodify-brand'}>
      <Waveform size={footer ? 26 : 34} />
      <span className={footer ? 'melodify-wordmark melodify-wordmark--footer' : 'melodify-wordmark'}>
        <span className="melodify-wordmark-main">Melod</span>
        <span className="melodify-wordmark-accent">ify</span>
      </span>
    </span>
  );
}
