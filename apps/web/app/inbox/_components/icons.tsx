/**
 * Icon re-exports from lucide-react, plus the Adventure Scientists monogram.
 *
 * All inbox components import icons from this barrel so swapping the
 * underlying icon library is a single-file change.
 *
 * `AdventureScientistsLogo` is re-exported from the shared
 * `app/_components/` location so inbox-scoped callers keep working while the
 * shared {@link ../../_components/primary-icon-rail.PrimaryIconRail} can
 * render it without reaching into `inbox/_components`.
 */
export { AdventureScientistsLogo } from "@/app/_components/adventure-scientists-logo";

export {
  Inbox as InboxIcon,
  Megaphone as MegaphoneIcon,
  Settings as SettingsIcon,
  Search as SearchIcon,
  SlidersHorizontal as FilterIcon,
  Mail as MailIcon,
  Phone as PhoneIcon,
  FileText as NoteIcon,
  Sparkles as SparkleIcon,
  Send as SendIcon,
  ChevronRight as ChevronRightIcon,
  MapPin as MapPinIcon,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  PanelRightOpen as PanelRightOpenIcon,
  PanelRightClose as PanelRightCloseIcon,
  CornerUpLeft as CornerUpLeftIcon,
  ArrowRight as ArrowRightIcon,
  X as XIcon,
  LogOut as LogOutIcon,
  Loader2 as LoaderIcon,
  Check as CheckIcon,
  CheckCircle2 as CheckCircleIcon,
  AlertCircle as AlertCircleIcon,
  AlertTriangle as AlertTriangleIcon,
  XCircle as XCircleIcon,
  RefreshCw as RefreshCwIcon,
  Pencil as PencilIcon,
  Trash2 as Trash2Icon,
  Trash2 as TrashIcon,
  Wand2 as WandIcon,
  Bot as BotIcon,
  Zap as ZapIcon,
  WifiOff as WifiOffIcon,
  Save as SaveIcon,
  RotateCcw as RotateCcwIcon,
  RotateCw as RotateCwIcon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  SearchX as SearchXIcon,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  Image as ImageIcon,
  Paperclip as PaperclipIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  Upload as UploadIcon,
  FileIcon as FileDocIcon,
  Eye as EyeIcon,
  MousePointerClick as MousePointerClickIcon,
  Flag as FlagIcon,
  MailOpen as MailOpenIcon,
  ArrowUpRight as ArrowUpRightIcon,
  Quote as QuoteIcon,
  Database as DatabaseIcon,
  Archive as ArchiveBoxIcon,
} from "lucide-react";
