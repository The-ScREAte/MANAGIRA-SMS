import { cn } from "@/lib/utils";

interface ActivityItemProps {
  user: string;
  action: string;
  target: string;
  time: string;
  avatar: string;
  delay?: number;
}

const ActivityItem = ({ user, action, target, time, avatar, delay = 0 }: ActivityItemProps) => {
  return (
    <div 
      className="flex items-start gap-4 py-4 animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground text-sm font-medium shrink-0">
        {avatar}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-card-foreground">
          <span className="font-medium">{user}</span>{" "}
          <span className="text-muted-foreground">{action}</span>{" "}
          <span className="font-medium">{target}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">{time}</p>
      </div>
    </div>
  );
};

export default ActivityItem;
