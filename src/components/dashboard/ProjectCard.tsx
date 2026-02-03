import { MoreHorizontal, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectCardProps {
  name: string;
  description: string;
  progress: number;
  members: number;
  status: "active" | "completed" | "paused";
  color: string;
  delay?: number;
}

const statusConfig = {
  active: { label: "Active", class: "bg-status-success/10 text-status-success" },
  completed: { label: "Completed", class: "bg-status-info/10 text-status-info" },
  paused: { label: "Paused", class: "bg-status-warning/10 text-status-warning" },
};

const ProjectCard = ({ 
  name, 
  description, 
  progress, 
  members, 
  status,
  color,
  delay = 0
}: ProjectCardProps) => {
  const statusInfo = statusConfig[status];

  return (
    <div 
      className="bg-card rounded-xl p-5 shadow-soft hover:shadow-card transition-all duration-300 animate-slide-up group cursor-pointer"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div 
          className="w-10 h-10 rounded-lg flex items-center justify-center text-primary-foreground font-semibold text-sm"
          style={{ background: color }}
        >
          {name.charAt(0)}
        </div>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded-lg">
          <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <h3 className="font-semibold text-card-foreground mb-1">{name}</h3>
      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{description}</p>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium text-card-foreground">{progress}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: color }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          <span>{members} members</span>
        </div>
        <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full", statusInfo.class)}>
          {statusInfo.label}
        </span>
      </div>
    </div>
  );
};

export default ProjectCard;
