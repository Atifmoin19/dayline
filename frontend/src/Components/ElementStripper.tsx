import React, { useState, useRef, useEffect } from "react";
import { PageWrapper } from "AppRouter";
// --- CUSTOM HOOK TO MEASURE DIMENSIONS ---
const useComponentSize = () => {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (ref.current) {
      const observer = new ResizeObserver((entries) => {
        // We only care about the first element in the array
        const { width, height } = entries[0].contentRect;
        setSize({ width, height });
      });

      observer.observe(ref.current);

      return () => observer.disconnect();
    }
  }, []);

  return [size, ref];
};

export const ComponentStripper = ({
  SourceComponent,
  nStrips = 4, // Using your example nStrips=4
  componentProps = {},
}) => {
  // ... (useComponentSize hook and dimension calculation remains the same) ...

  const [size, originalComponentRef] = useComponentSize();
  const { width, height } = size;

  if (width === 0 || height === 0) {
    return (
      <div
        ref={originalComponentRef}
        style={{ visibility: "hidden", position: "absolute" }}
      >
        <SourceComponent {...componentProps} />
      </div>
    );
  }

  const stripWidth = width / nStrips;
  const stripIndices = Array.from({ length: nStrips }, (_, i) => i);

  return (
    <div
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: "relative",
        overflow: "hidden",
      }}
      className="stripper-container"
    >
      {stripIndices.map((index) => {
        const leftOffset = index * stripWidth;

        return (
          <div
            key={index}
            style={{
              position: "absolute",
              top: 0,
              width: `${stripWidth}px`,
              height: `${height}px`,
              left: `${leftOffset}px`,
              overflow: "hidden",
              boxSizing: "border-box",
            }}
            className={`strip-element strip-${index}`}
          >
            <PageWrapper idx={index}>
              <div
                style={{
                  position: "relative",
                  // This is the crucial slicing line
                  transform: `translateX(-${leftOffset}px)`,
                  width: `${width}px`,
                  height: `${height}px`,
                }}
              >
                <SourceComponent {...componentProps} />
              </div>
            </PageWrapper>
          </div>
        );
      })}
    </div>
  );
};
