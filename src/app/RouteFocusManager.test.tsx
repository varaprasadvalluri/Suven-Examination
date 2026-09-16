import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { RouteFocusManager } from './RouteFocusManager';

function Harness() {
  return (
    <MemoryRouter initialEntries={['/a']}>
      <RouteFocusManager />
      {/* Stands in for Layout's content region, which carries the same id and tabIndex. */}
      <div id="main-content" tabIndex={-1}>
        <Link to="/b">go to B</Link>
        <Routes>
          <Route path="/a" element={<p>page A</p>} />
          <Route path="/b" element={<p>page B</p>} />
        </Routes>
      </div>
    </MemoryRouter>
  );
}

describe('RouteFocusManager', () => {
  // Without this, a client-side navigation leaves focus on a link in the previous page and a
  // screen reader never announces that the page changed.
  it('moves focus to the main content region after a navigation', async () => {
    render(<Harness />);
    expect(document.activeElement).toBe(document.body);

    await userEvent.click(screen.getByRole('link', { name: /go to b/i }));

    expect(await screen.findByText('page B')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  // Focusing on first paint would jump the user past the skip link before they could use it.
  it('does not steal focus on the initial render', () => {
    render(<Harness />);
    expect(document.activeElement).not.toBe(document.getElementById('main-content'));
  });

  // Login and the exam screen render no Layout, so the target simply is not there.
  it('is a no-op when no main content region exists', async () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <Link to="/b">go to B</Link>
        <Routes>
          <Route path="/a" element={<p>page A</p>} />
          <Route path="/b" element={<p>page B</p>} />
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('link', { name: /go to b/i }));
    expect(await screen.findByText('page B')).toBeInTheDocument();
  });
});
