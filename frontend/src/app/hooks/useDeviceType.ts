import { useWindowDimensions } from "./useWindowDimention";

interface IUseDeviceType {
  isDesktop: boolean;
  isTablet: boolean;
  isMobile: boolean;
}

const useDeviceType = () => {
  const { width } = useWindowDimensions();

  let isDesktop = false,
    isTablet = false,
    isMobile = false;

  if (width >= 1100) {
    isDesktop = true;
  } else if (width >= 768) {
    isTablet = true;
  } else {
    isMobile = true;
  }

  return { isDesktop, isTablet, isMobile };
};

export { useDeviceType };
export type { IUseDeviceType };
