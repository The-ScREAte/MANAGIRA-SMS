import { CheckCircle2, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  title: string;
  project: string;
  priority: "high" | "medium" | "low";
  completed: boolean;
  dueDate: string;
}

interface TaskListProps {
  tasks: Task[];
}

const priorityConfig = {
  high: { class: "bg-status-error/10 text-status-error", label: "High" },
  medium: { class: "bg-status-warning/10 text-status-warning", label: "Medium" },
  low: { class: "bg-status-info/10 text-status-info", label: "Low" },
};

const TaskList = ({ tasks }: TaskListProps) => {
  return (
    <div className="space-y-2">
      {tasks.map((task, index) => (
        <div
          key={task.id}
          className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer animate-slide-up"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <button className="shrink-0">
            {task.completed ? (
              <CheckCircle2 className="w-5 h-5 text-status-success" />
            ) : (
              <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />
            )}
          </button>
          
          <div className="flex-1 min-w-0">
            <p className={cn(
              "text-sm font-medium",
              task.completed ? "text-muted-foreground line-through" : "text-card-foreground"
            )}>
              {task.title}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{task.project}</p>
          </div>

          <span className={cn(
            "text-xs font-medium px-2 py-1 rounded-full shrink-0",
            priorityConfig[task.priority].class
          )}>
            {priorityConfig[task.priority].label}
          </span>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Clock className="w-3.5 h-3.5" />
            {task.dueDate}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TaskList;
