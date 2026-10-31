/**
 * Icon shim — the app's single icon source. Re-exports lucide-react icons under the `Fa*`
 * names the codebase already uses, so switching libraries is a one-line import-source change
 * per file (no per-usage renames). Each icon defaults to `1em` (matching the old react-icons
 * sizing); Chakra `<Icon as={...} boxSize>` still overrides it.
 */
import React from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Zap,
  Building2,
  Calendar,
  BarChart3,
  LineChart,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  UploadCloud,
  Scissors,
  Download,
  SquarePen,
  Mail,
  AlertCircle,
  FileSpreadsheet,
  GraduationCap,
  History,
  IdCard,
  Link,
  Map,
  MapPin,
  Pause,
  Phone,
  Plus,
  Power,
  Bell,
  CircleCheck,
  Clipboard,
  Search,
  ZoomIn,
  Network,
  ListChecks,
  LayoutGrid,
  X,
  Droplet,
  Trash2,
  CircleUser,
  UserPen,
  UserPlus,
  UserRound,
  Users,
  Bookmark,
  BookmarkPlus,
  Tag,
  Flag,
  MessageSquare,
  MoreVertical,
  ChevronUp,
  Paperclip,
  Maximize2,
  Menu as MenuIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

const sized = (Icon: LucideIcon) => {
  const Wrapped = React.forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Icon ref={ref} size="1em" {...props} />
  ));
  Wrapped.displayName = (Icon as { displayName?: string }).displayName || "Icon";
  return Wrapped;
};

export const FaBars = sized(MenuIcon);
export const FaAngleDoubleLeft = sized(ChevronsLeft);
export const FaAngleDoubleRight = sized(ChevronsRight);
export const FaBolt = sized(Zap);
export const FaBuilding = sized(Building2);
export const FaCalendarAlt = sized(Calendar);
export const FaChartBar = sized(BarChart3);
export const FaChartLine = sized(LineChart);
export const FaCheck = sized(Check);
export const FaChevronDown = sized(ChevronDown);
export const FaChevronLeft = sized(ChevronLeft);
export const FaChevronRight = sized(ChevronRight);
export const FaClock = sized(Clock);
export const FaCloudUploadAlt = sized(UploadCloud);
export const FaCut = sized(Scissors);
export const FaDownload = sized(Download);
export const FaEdit = sized(SquarePen);
export const FaEnvelope = sized(Mail);
export const FaExclamationCircle = sized(AlertCircle);
export const FaFileCsv = sized(FileSpreadsheet);
export const FaGraduationCap = sized(GraduationCap);
export const FaHistory = sized(History);
export const FaIdBadge = sized(IdCard);
export const FaLink = sized(Link);
export const FaLinkedin = sized(Link); // lucide dropped brand icons; generic link
export const FaMap = sized(Map);
export const FaMapMarkerAlt = sized(MapPin);
export const FaPause = sized(Pause);
export const FaPhone = sized(Phone);
export const FaPlus = sized(Plus);
export const FaPowerOff = sized(Power);
export const FaRegBell = sized(Bell);
export const FaRegCheckCircle = sized(CircleCheck);
export const FaRegClipboard = sized(Clipboard);
export const FaSearch = sized(Search);
export const FaSearchPlus = sized(ZoomIn);
export const FaSitemap = sized(Network);
export const FaTasks = sized(ListChecks);
export const FaThLarge = sized(LayoutGrid);
export const FaTimes = sized(X);
export const FaTint = sized(Droplet);
export const FaTrash = sized(Trash2);
export const FaUserCircle = sized(CircleUser);
export const FaUserEdit = sized(UserPen);
export const FaUserPlus = sized(UserPlus);
export const FaUserTie = sized(UserRound);
export const FaUsers = sized(Users);
export const FaBookmark = sized(Bookmark);
export const FaBookmarkPlus = sized(BookmarkPlus);
export const FaTag = sized(Tag);
export const FaFlag = sized(Flag);
export const FaComment = sized(MessageSquare);
export const FaEllipsisV = sized(MoreVertical);
export const FaChevronUp = sized(ChevronUp);
export const FaPaperclip = sized(Paperclip);
export const FaExpand = sized(Maximize2);
