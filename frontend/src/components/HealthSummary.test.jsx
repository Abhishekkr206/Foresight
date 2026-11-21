import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { formatHealth, healthStatus, HealthOverview } from './HealthSummary';
import Sidebar from './Sidebar';

afterEach(cleanup);
const summary = { forest_health_score: 95.6, observed_zone_count: 8, populated_zone_count: 8,
  affected_zone_count: 1, total_zone_count: 16, active_threat_penalty: 4.4, active_threat_count: 1 };

it('formats a real zero, a fractional score, and missing data distinctly', () => {
  expect(formatHealth(0)).toBe('0%');
  expect(formatHealth(95.6)).toBe('95.6%');
  expect(formatHealth(100)).toBe('100%');
  expect(formatHealth(null)).toBe('\u2014');
  expect(formatHealth(undefined)).toBe('\u2014');
});

it('shows only monitored count and an active zone alert', () => {
  render(<HealthOverview summary={summary} />);
  expect(screen.getByText('8 zones monitored')).toBeTruthy();
  expect(screen.getByTestId('health-impact').textContent).toBe('1 zone affected');
  expect(screen.queryByTestId('health-coverage')).toBeNull();
  expect(screen.queryByText(/percentage points/)).toBeNull();
});

it('only shows a coverage warning when reporting is incomplete', () => {
  render(<HealthOverview summary={{ ...summary, observed_zone_count: 1, affected_zone_count: 0,
    forest_health_score: 80, active_threat_penalty: 0 }} />);
  expect(screen.getByTestId('health-coverage').textContent).toContain('Limited coverage: 1 of 8');
  expect(screen.queryByTestId('health-impact')).toBeNull();
});

it('does not claim a healthy soundscape when there are no observations', () => {
  const empty = { ...summary, forest_health_score: null, observed_zone_count: 0,
    affected_zone_count: 0, active_threat_penalty: 0 };
  render(<Sidebar open health={null} summary={empty} />);
  expect(screen.getByText('Waiting for recent audio')).toBeTruthy();
  expect(screen.getByText('\u2014')).toBeTruthy();
  expect(screen.queryByText('Soundscape stable')).toBeNull();
  expect(screen.queryByText('100%')).toBeNull();
  expect(healthStatus(empty)).toBe('Waiting for recent audio');
});

it('uses the same fractional score and locality explanation in the sidebar', () => {
  render(<Sidebar open health={summary.forest_health_score} summary={summary} />);
  expect(screen.getByText('95.6%')).toBeTruthy();
  expect(screen.getByText('1 zone affected')).toBeTruthy();
});

