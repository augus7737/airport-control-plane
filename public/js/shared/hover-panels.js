export function createHoverPanelsModule(dependencies = {}) {
  const {
    documentRef = document,
    windowRef = window,
  } = dependencies;

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
  }

  function bindHoverPanel(card) {
    if (!card || card.dataset.hoverPanelBound === "1") {
      return;
    }

    const refreshPlacement = () => applyHoverPanelPlacement(card);
    card.dataset.hoverPanelBound = "1";
    card.addEventListener("mouseenter", refreshPlacement);
    card.addEventListener("focusin", refreshPlacement);
  }

  function setupHoverPanels(root = documentRef) {
    root.querySelectorAll(".cell-hover-card").forEach(bindHoverPanel);
  }

  return {
    applyHoverPanelPlacement,
    setupHoverPanels,
  };
}
