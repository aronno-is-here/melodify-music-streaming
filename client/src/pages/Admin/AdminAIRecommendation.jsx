import { useState } from 'react';
import { useAdminRecommendationMetrics } from '../../hooks/useAdminRecommendationMetrics.js';
import {
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
} from '../../services/adminRecommendationMetrics.js';
import {
  ADMIN_AI_DASHBOARD_MESSAGES,
  ADMIN_AI_DASHBOARD_VIEWS,
  buildMetricCards,
  buildRunMetaCards,
  buildSummaryCards,
  getPipelineStageLabel,
  selectAdminRecommendationDashboardView,
} from './aiRecommendationMetricsUi.js';

export default function AdminAIRecommendation() {
  const [selectedStage, setSelectedStage] = useState(
    DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  );
  const { state, latest, refresh } = useAdminRecommendationMetrics({
    pipelineStage: selectedStage,
  });
  const view = selectAdminRecommendationDashboardView(state);
  const metricCards = view === ADMIN_AI_DASHBOARD_VIEWS.READY
    ? buildMetricCards(latest.metrics)
    : [];
  const summaryCards = view === ADMIN_AI_DASHBOARD_VIEWS.READY
    ? buildSummaryCards(latest.summary)
    : [];
  const metaCards = view === ADMIN_AI_DASHBOARD_VIEWS.READY
    ? buildRunMetaCards(latest)
    : [];

  return (
    <div id="ai-recommendation" className="card">
      <h2>AI Recommendation</h2>
      <p className="ai-rec-subtitle">
        Monitor the latest persisted recommendation evaluation for each pipeline stage.
      </p>

      <div
        className="ai-rec-stage-selector"
        role="group"
        aria-label="Pipeline stage"
      >
        {ADMIN_RECOMMENDATION_PIPELINE_STAGES.map((stage) => (
          <button
            key={stage}
            type="button"
            className={
              stage === selectedStage
                ? 'ai-rec-stage-btn active'
                : 'ai-rec-stage-btn'
            }
            aria-pressed={stage === selectedStage}
            onClick={() => setSelectedStage(stage)}
          >
            {getPipelineStageLabel(stage)}
          </button>
        ))}
      </div>

      {view === ADMIN_AI_DASHBOARD_VIEWS.LOADING && (
        <p className="ai-rec-state" role="status" aria-live="polite">
          {ADMIN_AI_DASHBOARD_MESSAGES.LOADING}
        </p>
      )}

      {view === ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS && (
        <p className="ai-rec-state" role="status" aria-live="polite">
          {ADMIN_AI_DASHBOARD_MESSAGES.NO_RUNS}
        </p>
      )}

      {view === ADMIN_AI_DASHBOARD_VIEWS.ERROR && (
        <div className="ai-rec-state ai-rec-error" role="alert">
          <p>{ADMIN_AI_DASHBOARD_MESSAGES.ERROR}</p>
          <button type="button" className="btn" onClick={() => refresh()}>
            {ADMIN_AI_DASHBOARD_MESSAGES.RETRY}
          </button>
        </div>
      )}

      {view === ADMIN_AI_DASHBOARD_VIEWS.READY && (
        <div className="ai-rec-ready">
          <div className="ai-rec-meta">
            {metaCards.map((card) => (
              <div key={card.key} className="ai-rec-meta-item">
                <span className="ai-rec-meta-label">{card.label}</span>
                <span className="ai-rec-meta-value">{card.value}</span>
              </div>
            ))}
          </div>

          <h3 className="ai-rec-section-title">Metrics</h3>
          <div className="ai-rec-metric-grid">
            {metricCards.map((card) => (
              <div key={card.key} className="ai-rec-metric-card">
                <span className="ai-rec-metric-label">{card.label}</span>
                <span className="ai-rec-metric-value">{card.formatted}</span>
              </div>
            ))}
          </div>

          <h3 className="ai-rec-section-title">Summary</h3>
          <div className="ai-rec-summary-grid">
            {summaryCards.map((card) => (
              <div key={card.key} className="ai-rec-summary-card">
                <span className="ai-rec-summary-label">{card.label}</span>
                <span className="ai-rec-summary-value">{card.formatted}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
