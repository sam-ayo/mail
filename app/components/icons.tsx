import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Archive02Icon,
  ArrowDown01Icon,
  ArrowExpand01Icon,
  ArrowLeft02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowShrink02Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  Cancel01Icon,
  ComputerIcon,
  CheckmarkSquare02Icon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  File01Icon,
  File02Icon,
  HardDriveIcon,
  InboxIcon,
  InformationCircleIcon,
  KeyboardIcon,
  Link01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  Login03Icon,
  Logout03Icon,
  Mail01Icon,
  MailOpen01Icon,
  MailReply01Icon,
  MailReplyAll01Icon,
  MailSend01Icon,
  Megaphone01Icon,
  Menu01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  Notification01Icon,
  NotificationOff01Icon,
  PencilEdit01Icon,
  PencilEdit02Icon,
  Refresh01Icon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  SpamIcon,
  StarIcon,
  Sun03Icon,
  Tick02Icon,
  UnfoldLessIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

// The app uses the free Hugeicons set, which has only stroke icons. The
// "bold" weight makes the stroke heavier. The "fill" weight fills the closed
// shapes, so use it only on solid shapes such as the star.
export type IconProps = Omit<HugeiconsIconProps, "icon"> & { weight?: "regular" | "bold" | "fill" };
export type Icon = (props: IconProps) => React.ReactNode;

function icon(svg: IconSvgElement): Icon {
  return ({ weight = "regular", ...props }) => (
    <HugeiconsIcon
      icon={svg}
      size="1em"
      strokeWidth={weight === "bold" ? 2 : 1.5}
      fill={weight === "fill" ? "currentColor" : "none"}
      aria-hidden
      {...props}
    />
  );
}

export const Archive = icon(Archive02Icon);
export const ArrowBendDoubleUpLeft = icon(MailReplyAll01Icon);
export const ArrowBendUpLeft = icon(MailReply01Icon);
export const ArrowBendUpRight = icon(MailSend01Icon);
export const ArrowClockwise = icon(Refresh01Icon);
export const ArrowLeft = icon(ArrowLeft02Icon);
export const ArrowSquareOut = icon(LinkSquare02Icon);
export const ArrowsInLineVertical = icon(UnfoldLessIcon);
export const ArrowsInSimple = icon(ArrowShrink02Icon);
export const ArrowsOutSimple = icon(ArrowExpand01Icon);
export const Bell = icon(Notification01Icon);
export const BellSlash = icon(NotificationOff01Icon);
export const CaretDown = icon(ArrowDown01Icon);
export const CaretLeft = icon(ArrowLeft01Icon);
export const CaretRight = icon(ArrowRight01Icon);
export const CaretUp = icon(ArrowUp01Icon);
export const Check = icon(Tick02Icon);
export const CheckSquare = icon(CheckmarkSquare02Icon);
export const CircleNotch = icon(Loading03Icon);
export const Copy = icon(Copy01Icon);
export const Desktop = icon(ComputerIcon);
export const DotsThree = icon(MoreHorizontalIcon);
export const DownloadSimple = icon(Download04Icon);
export const EnvelopeSimple = icon(Mail01Icon);
export const EnvelopeSimpleOpen = icon(MailOpen01Icon);
export const File = icon(File01Icon);
export const FileText = icon(File02Icon);
export const Gear = icon(Settings01Icon);
export const HardDrives = icon(HardDriveIcon);
export const Info = icon(InformationCircleIcon);
export const Keyboard = icon(KeyboardIcon);
export const LinkSimple = icon(Link01Icon);
export const Megaphone = icon(Megaphone01Icon);
export const List = icon(Menu01Icon);
export const MagnifyingGlass = icon(Search01Icon);
export const MarkdownLogo = icon(ViewIcon);
export const Moon = icon(Moon02Icon);
export const NotePencil = icon(PencilEdit02Icon);
export const PaperPlaneTilt = icon(SentIcon);
export const Paperclip = icon(Attachment01Icon);
export const PencilSimple = icon(PencilEdit01Icon);
export const Plus = icon(Add01Icon);
export const ShieldWarning = icon(SpamIcon);
export const SidebarSimple = icon(SidebarLeftIcon);
export const SignIn = icon(Login03Icon);
export const SignOut = icon(Logout03Icon);
export const Sparkle = icon(SparklesIcon);
export const Star = icon(StarIcon);
export const Sun = icon(Sun03Icon);
export const Trash = icon(Delete02Icon);
export const Tray = icon(InboxIcon);
export const Warning = icon(Alert02Icon);
export const X = icon(Cancel01Icon);
