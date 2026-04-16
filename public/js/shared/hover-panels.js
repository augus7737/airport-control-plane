export function createHoverPanelsModule(dependencies = {}) {
  const {
    documentRef = document,
    windowRef = window,
  } = dependencies;

  function setActiveHoverHost(card, active) {
    if (!card) {
      return;
    }

    const hostCell = card.closest("td, th");
    const hostRow = card.closest("tr");
    const tableShell = card.closest(".table-shell");

    if (hostCell) {
      hostCell.classList.toggle("cell-hover-host-active", active);
    }

    if (hostRow) {
      hostRow.classList.toggle("cell-hover-row-active", active);
    }

    if (tableShell) {
      tableShell.classList.toggle("cell-hover-shell-active", active);
    }
  }

  function getBoundaryRect(card) {
    const shell = card.closest(".table-shell");
    if (!shell) {
      return {
        top: 12,
        right: windowRef.innerWidth - 12,
        bottom: windowRef.innerHeight - 12,
        left: 12,
      };
    }

    const rect = shell.getBoundingClientRect();
    return {
      top: Math.max(rect.top + 8, 12),
      right: Math.min(rect.right - 8, windowRef.innerWidth - 12),
      bottom: Math.min(rect.bottom - 8, windowRef.innerHeight - 12),
      left: Math.max(rect.left + 8, 12),
    };
  }

  function applyHoverPanelPlacement(card) {
    if (!card) {
      return;
    }

    const panel = card.querySelector(".cell-hover-panel");
    if (!panel) {
      return;
    }

    const cardRect = card.getBoundingClientRect();
    const boundary = getBoundaryRect(card);
    const maxWidth = Math.max(
      Math.min(Math.floor(boundary.right - boundary.left), 320),
      220,
    );
    const panelWidth = Math.min(
      Math.max(panel.offsetWidth, panel.scrollWidth, 0),
      maxWidth,
    );
    const panelHeight = Math.max(panel.offsetHeight, panel.scrollHeight, 0);
    const spaceBelow = boundary.bottom - (cardRect.bottom + 8);
    const spaceAbove = cardRect.top - 8 - boundary.top;
    const placement =
      spaceBelow >= panelHeight || spaceBelow >= spaceAbove ? "bottom" : "top";
    const availableHeight = Math.max(
      placement === "bottom" ? spaceBelow : spaceAbove,
      140,
    );
    const overflowsRight = cardRect.left + panelWidth > boundary.right;
    const canAlignRight = cardRect.right - panelWidth >= boundary.left;

    card.dataset.panelPlacement = placement;
    card.dataset.panelAlign = overflowsRight && canAlignRight ? "right" : "left";
    card.style.setProperty(
      "--cell-hover-max-height",
      `${Math.max(Math.min(Math.floor(availableHeight), 360), 140)}px`,
    );
    card.style.setProperty("--cell-hover-max-width", `${maxWidth}px`);
    panel.scrollTop = 0;
  }

  function bindHoverPanel(card) {
    if (!card || card.dataset.hoverPanelBound === "1") {
      return;
    }

    const refreshPlacement = () => {
      setActiveHoverHost(card, true);
      applyHoverPanelPlacement(card);
    };
    const clearPlacement = (event) => {
      const relatedTarget = event?.relatedTarget;
      if (relatedTarget && card.contains(relatedTarget)) {
        return;
      }
      setActiveHoverHost(card, false);
    };
    card.dataset.hoverPanelBound = "1";
    card.addEventListener("mouseenter", refreshPlacement);
    card.addEventListener("focusin", refreshPlacement);
    card.addEventListener("mouseleave", clearPlacement);
    card.addEventListener("focusout", clearPlacement);
  }

  function setupHoverPanels(root = documentRef) {
    root.querySelectorAll(".cell-hover-card").forEach(bindHoverPanel);
  }

  return {
    applyHoverPanelPlacement,
    setupHoverPanels,
  };
}
