import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, PageHeader, StatusBadge } from '../components/ui';
import { ToastProvider, useToast } from '../components/Toast';

function ToastProbe() {
  const { notify } = useToast();
  return <Button onClick={() => notify('Run completed', 'success', 'Quality score 98%')}>Trigger notification</Button>;
}

describe('QualityLens UI primitives', () => {
  it('renders a page header and normalized status badge', () => {
    render(<><PageHeader title="Data quality" description="Validation results" /><StatusBadge status="detected_drift" /></>);
    expect(screen.getByRole('heading', { name: 'Data quality' })).toBeInTheDocument();
    expect(screen.getByText('detected drift')).toBeInTheDocument();
  });

  it('shows an in-app notification after a user action', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><ToastProbe /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Trigger notification' }));
    expect(screen.getByRole('status')).toHaveTextContent('Run completed');
    expect(screen.getByRole('status')).toHaveTextContent('Quality score 98%');
  });
});
