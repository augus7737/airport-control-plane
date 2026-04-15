export function createNodeAssetModalEventsModule(dependencies = {}) {
  const { documentRef = document } = dependencies;

  function bindEscapeClose(modal, close) {
    if (modal.dataset.escapeBound === "1") {
      return;
    }

    modal.dataset.escapeBound = "1";
    documentRef.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });
  }

  function bindManualModalEvents({ modal, openButton, closeButton, form, resetButton, message, open, close }) {
    openButton?.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });
    resetButton?.addEventListener("click", () => {
      form.reset();
      message.innerHTML = "";
    });
  }

  function bindAssetModalCoreEvents({ modal, closeButton, close, resetButton, fillForm }) {
    closeButton.onclick = close;
    modal.onclick = (event) => {
      if (event.target === modal) {
        close();
      }
    };
    if (resetButton) {
      resetButton.onclick = fillForm;
    }
  }

  function bindAssetModalOpenTriggers({ openButton, onOpenCurrentNode, onOpenFromNodeId }) {
    if (openButton) {
      openButton.onclick = onOpenCurrentNode;
    }

    documentRef.querySelectorAll("[data-open-asset-modal]").forEach((button) => {
      button.onclick = () => {
        onOpenFromNodeId(button.getAttribute("data-open-asset-modal"));
      };
    });
  }

  return {
    bindAssetModalCoreEvents,
    bindAssetModalOpenTriggers,
    bindEscapeClose,
    bindManualModalEvents,
  };
}
