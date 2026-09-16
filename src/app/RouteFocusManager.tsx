import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves focus to the main content region on every client-side navigation.
 *
 * A full page load resets focus and makes a screen reader announce the new document. A
 * client-side route change does neither: focus stays wherever it was — often on a nav link
 * that no longer exists — so keyboard users resume tabbing from the middle of the previous
 * page, and screen-reader users get no indication the page changed at all.
 *
 * The target is the `#main-content` region in Layout, which already carries tabIndex={-1} for
 * the skip link. Routes that render no Layout (login, the exam screen) simply have no target;
 * those are full-screen single-purpose views where focus has nowhere better to go.
 */
export const RouteFocusManager: React.FC = () => {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // The initial load already behaves correctly — moving focus here would instead skip past
    // the skip link before the user has had a chance to use it.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const main = document.getElementById('main-content');
    if (main) {
      main.focus();
      // Route changes should start at the top, the way a document load does. scrollTop rather
      // than scrollTo: the latter is not implemented on elements in every environment, and a
      // navigation must not be able to throw on its way to a new page.
      main.scrollTop = 0;
    }
    window.scrollTo?.({ top: 0 });
  }, [pathname]);

  return null;
};
