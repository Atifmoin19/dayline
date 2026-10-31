import { motion } from "framer-motion";

/**
 * Creates a transition where one strip covers the screen (exit)
 * and a second strip immediately slides out to reveal the new page (entry).
 */
const transition = (OgComponent) => {
  // Define the common transition properties
  const pageTransition = {
    duration: 1,
    ease: [0.22, 1, 0.36, 1], // Custom easing for smooth motion
  };

  return (props) => (
    <>
      {/* 1. The original component */}
      <OgComponent {...props} />

      {/* --- A. COVER STRIP (Exit Animation) ---
        Role: Covers the screen (0 -> 1) when the page is exiting.
        Initial state is set to 1 so it's ready to go.
        transformOrigin: bottom means it slides up from the bottom.
      */}
      <motion.div
        className="cover-strip"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100vh",
          backgroundColor: "#000",
          zIndex: 999,
          transformOrigin: "bottom",
        }}
        // Starts off-screen (revealed)
        initial={{ scaleY: 0 }}
        // Stays off-screen while the new page loads
        animate={{ scaleY: 0 }}
        // EXIT: Scales UP to cover the screen (0 -> 1)
        exit={{ scaleY: 1 }}
        transition={pageTransition}
      />

      {/* --- B. REVEAL STRIP (Entry Animation) ---
        Role: Reveals the page (1 -> 0) immediately after the cover strip finishes.
        We must use 'mode="wait"' on AnimatePresence for this to work perfectly.
        transformOrigin: bottom means it slides up and off the screen from the bottom.
      */}
      <motion.div
        className="reveal-strip"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100vh",
          backgroundColor: "#000",
          zIndex: 998, // One layer below the cover strip
          transformOrigin: "bottom",
        }}
        // ENTRY: Starts covered (1)
        initial={{ scaleY: 1 }}
        // Animates to revealed (0), sliding up and off the screen
        animate={{ scaleY: 0 }}
        // Stays off-screen when the old page exits
        exit={{ scaleY: 0 }}
        transition={pageTransition}
      />
    </>
  );
};

export default transition;
