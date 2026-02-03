import { 
  LayoutDashboard, 
  FolderKanban, 
  CheckSquare, 
  Calendar, 
  Users, 
  Settings,
  Plus,
  Search
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  className?: string;
}

const navigation = [
  { name: "Dashboard", icon: LayoutDashboard, href: "#", current: true },
  { name: "Projects", icon: FolderKanban, href: "#", current: false },
  { name: "Tasks", icon: CheckSquare, href: "#", current: false },
  { name: "Calendar", icon: Calendar, href: "#", current: false },
  { name: "Team", icon: Users, href: "#", current: false },
];

const Sidebar = ({ className }: SidebarProps) => {
  return (
    <aside className={cn(
      "fixed left-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col",
      className
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
          <span className="text-sm font-bold text-sidebar-primary-foreground">M</span>
        </div>
        <span className="text-lg font-semibold">Managira</span>
      </div>

      {/* Search */}
      <div className="px-4 py-4">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-sm hover:bg-sidebar-accent/80 transition-colors">
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">Search...</span>
          <kbd className="ml-auto text-xs bg-sidebar-border px-1.5 py-0.5 rounded">⌘K</kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-1">
          {navigation.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  item.current
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/25"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* New Project Button */}
      <div className="px-4 pb-4">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg gradient-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity shadow-lg shadow-primary/25">
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Settings */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <a
          href="#"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Settings className="w-5 h-5" />
          Settings
        </a>
      </div>
    </aside>
  );
};

export default Sidebar;
