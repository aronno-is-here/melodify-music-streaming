import { useState } from 'react';
import { useAdminRecommendationMetrics } from '../../hooks/useAdminRecommendationMetrics.js';
import { useAdminRecommendationHistory } from '../../hooks/useAdminRecommendationHistory.js';
import { useAdminRecommendationHealth } from '../../hooks/useAdminRecommendationHealth.js';
import {
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
} from '../../services/adminRecommendationMetrics.js';
import { DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT } from '../../services/adminRecommendationHistory.js';
import {
  ADMIN_AI_DASHBOARD_MESSAGES,
  ADMIN_AI_DASHBOARD_VIEWS,
  buildMetricCards,
  buildRunMetaCards,
  buildSummaryCards,
  getPipelineStageLabel,
  selectAdminRecommendationDashboardView,
} from './aiRecommendationMetricsUi.js';
import {
  ADMIN_AI_HISTORY_MESSAGES,
  ADMIN_AI_HISTORY_VIEWS,
  buildConfigurationCards,
  buildDatasetCards,
  formatArtifactVersion,
  formatEvaluationDate,
  selectAdminRecommendationHistoryView,
  selectHistoryRun,
} from './aiRecommendationHistoryUi.js';
import {
  ADMIN_AI_HEALTH_MESSAGES,
  ADMIN_AI_HEALTH_VIEWS,
  buildHealthStatusCards,
  selectAdminRecommendationHealthView,
} from './aiRecommendationHealthUi.js';

export default function AdminAIRecommendation() {
  const [selectedStage, setSelectedStage] = useState(
    DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  );
  const [selectedRunId, setSelectedRunId] = useState(null);

  const {
    state: metricsState,
    latest,
    refresh,
  } = useAdminRecommendationMetrics({
    pipelineStage: selectedStage,
  });
  const {
    state: historyState,
    runs: historyRuns,
    refresh: refreshHistory,
  } = useAdminRecommendationHistory({
    pipelineStage: selectedStage,
    limit: DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  });
  const {
    state: healthState,
    backendState,
    lease,
    latest: healthLatest,
    refresh: refreshHealth,
  } = useAdminRecommendationHealth();

  const view = selectAdminRecommendationDashboardView(metricsState);
  const metricCards = view === ADMIN_AI_DASHBOARD_VIEWS.READY
    ? buildMetricCards(latest.metrics)
    : [];
  const summaryCards = view === ADMIN_AI_DASHBOARD_VIEWS.READY
    ? buildSummaryCards(latest.summary)
    : [];
  const metaCards = view === ADMIN_AI_DASHBOARD_VIEWS.READY
    ? buildRunMetaCards(latest)
    : [];

  const historyView = selectAdminRecommendationHistoryView(historyState);
  const selectedRun = selectHistoryRun(historyRuns, selectedRunId);
  const datasetCards = selectedRun ? buildDatasetCards(selectedRun) : [];
  const reproCards = selectedRun
    ? buildConfigurationCards(selectedRun)
    : [];

  const healthView = selectAdminRecommendationHealthView(healthState);
  const healthCards =
    healthView === ADMIN_AI_HEALTH_VIEWS.READY
      ? buildHealthStatusCards(backendState, lease, healthLatest)
      : [];

  const handleStageChange = (stage) => {
    setSelectedStage(stage);
    setSelectedRunId(null);
  };

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
            onClick={() => handleStageChange(stage)}
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

      <h3 className="ai-rec-section-title">Evaluation History</h3>

      {historyView === ADMIN_AI_HISTORY_VIEWS.LOADING && (
        <p className="ai-rec-state" role="status" aria-live="polite">
          {ADMIN_AI_HISTORY_MESSAGES.LOADING}
        </p>
      )}

      {historyView === ADMIN_AI_HISTORY_VIEWS.NO_RUNS && (
        <p className="ai-rec-state" role="status" aria-live="polite">
          {ADMIN_AI_HISTORY_MESSAGES.NO_RUNS}
        </p>
      )}

      {historyView === ADMIN_AI_HISTORY_VIEWS.ERROR && (
        <div className="ai-rec-state ai-rec-error" role="alert">
          <p>{ADMIN_AI_HISTORY_MESSAGES.ERROR}</p>
          <button type="button" className="btn" onClick={() => refreshHistory()}>
            {ADMIN_AI_HISTORY_MESSAGES.RETRY}
          </button>
        </div>
      )}

      {historyView === ADMIN_AI_HISTORY_VIEWS.READY && (
        <div className="ai-rec-history-list">
          {historyRuns.map((run) => {
            const isSelected = selectedRun && selectedRun.run_id === run.run_id;
            return (
              <button
                key={run.run_id}
                type="button"
                className={
                  isSelected
                    ? 'ai-rec-history-row active'
                    : 'ai-rec-history-row'
                }
                aria-pressed={isSelected}
                onClick={() => setSelectedRunId(run.run_id)}
              >
                <span className="ai-rec-history-cell">
                  <span className="ai-rec-meta-label">Evaluated At</span>
                  <span className="ai-rec-meta-value">
                    {formatEvaluationDate(run.evaluated_at)}
                  </span>
                </span>
                <span className="ai-rec-history-cell">
                  <span className="ai-rec-meta-label">Run ID</span>
                  <span className="ai-rec-meta-value">{run.run_id}</span>
                </span>
                <span className="ai-rec-history-cell">
                  <span className="ai-rec-meta-label">Artifact Version</span>
                  <span className="ai-rec-meta-value">
                    {formatArtifactVersion(run.artifact_version)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedRun && (
        <>
          <h3 className="ai-rec-section-title">Dataset Statistics</h3>
          <div className="ai-rec-summary-grid">
            {datasetCards.map((card) => (
              <div key={card.key} className="ai-rec-summary-card">
                <span className="ai-rec-summary-label">{card.label}</span>
                <span className="ai-rec-summary-value">{card.formatted}</span>
              </div>
            ))}
          </div>

          <h3 className="ai-rec-section-title">Reproducibility Configuration</h3>
          <div className="ai-rec-summary-grid">
            {reproCards.map((card) => (
              <div key={card.key} className="ai-rec-summary-card">
                <span className="ai-rec-summary-label">{card.label}</span>
                <span className="ai-rec-summary-value">{card.formatted}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="ai-rec-section-title">Model Health</h3>

      {healthView === ADMIN_AI_HEALTH_VIEWS.LOADING && (
        <p className="ai-rec-state" role="status" aria-live="polite">
          {ADMIN_AI_HEALTH_MESSAGES.LOADING}
        </p>
      )}

      {healthView === ADMIN_AI_HEALTH_VIEWS.ERROR && (
        <div className="ai-rec-state ai-rec-error" role="alert">
          <p>{ADMIN_AI_HEALTH_MESSAGES.ERROR}</p>
          <button
            type="button"
            className="btn"
            onClick={() => refreshHealth()}
          >
            {ADMIN_AI_HEALTH_MESSAGES.RETRY}
          </button>
        </div>
      )}

      {healthView === ADMIN_AI_HEALTH_VIEWS.READY && (
        <div className="ai-rec-health">
          <div className="ai-rec-summary-grid">
            {healthCards.map((card) => (
              <div key={card.key} className="ai-rec-summary-card">
                <span className="ai-rec-summary-label">{card.label}</span>
                <span className="ai-rec-summary-value">{card.formatted}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn ai-rec-health-refresh"
            onClick={() => refreshHealth()}
          >
            {ADMIN_AI_HEALTH_MESSAGES.RETRY}
          </button>
        </div>
      )}
    </div>
  );
}
