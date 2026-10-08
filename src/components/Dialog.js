import { useEffect, useRef } from "react";

// `wide` is for the one dialog that holds a grid rather than a short form —
// a column of inputs one per category needs room the single-field modals don't.
export default function Dialog({ show, handleClose, title, wide, children }) {
  const dialogRef = useRef();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (show && !dialog.open) {
      dialog.showModal();
    } else if (!show && dialog.open) {
      dialog.close();
    }
  }, [show]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [handleClose]);

  function handleBackdropClick(e) {
    if (e.target === dialogRef.current) {
      dialogRef.current.close();
    }
  }

  return (
    /**
     * **A sheet off the bottom of a phone, a centred card everywhere else.**
     *
     * A `<dialog>` centres itself through `margin: auto` on all four sides, and
     * on a 390px screen that leaves a form floating in the middle with the
     * keyboard about to cover half of it. Pinning the margin to the bottom
     * (`mt-auto mb-0`) puts the sheet where the keyboard pushes from and the
     * thumb already is, lets it use the full width, and gives it a top edge the
     * reader can see it is a layer rather than a page. `sm:` puts every one of
     * those back.
     *
     * The title row **sticks**: these forms are long enough on a phone to
     * scroll, and a close button that scrolls away leaves the backdrop and the
     * Escape key as the only ways out — neither of which a sheet pinned to the
     * bottom edge advertises.
     */
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className={`mb-0 mt-auto max-h-[92vh] w-full max-w-none rounded-t-2xl border border-edge bg-panel p-0 font-sans text-chalk shadow-2xl shadow-black/50 backdrop:bg-black/60 sm:my-auto sm:max-h-[85vh] sm:rounded-none ${
        wide ? "sm:max-w-2xl" : "sm:max-w-lg"
      } overflow-y-auto`}
    >
      <div className="p-4 sm:p-6">
        <div className="sticky -top-4 z-10 mb-5 flex items-start justify-between gap-4 border-b border-edge bg-panel pb-4 pt-4 sm:static sm:pt-0">
          <div className="font-sans text-lg font-semibold tracking-tight text-chalk">{title}</div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current.close()}
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-edge text-base leading-none text-chalk-soft transition-colors hover:border-azure hover:text-azure sm:h-7 sm:w-7"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
