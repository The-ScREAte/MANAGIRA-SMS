import { FolderKanban, CheckSquare, Clock, TrendingUp, Bell, ChevronDown } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import StatCard from "@/components/dashboard/StatCard";
import ProjectCard from "@/components/dashboard/ProjectCard";
import ActivityItem from "@/components/dashboard/ActivityItem";
import TaskList from "@/components/dashboard/TaskList";

const projects = [
  {
    name: "Website Redesign",
    description: "Complete overhaul of the company website with new branding",
    progress: 75,
    members: 5,
    status: "active" as const,
    color: "linear-gradient(135deg, hsl(239 84% 67%) 0%, hsl(280 84% 60%) 100%)",
  },
  {
    name: "Mobile App",
    description: "Native iOS and Android application development",
    progress: 45,
    members: 8,
    status: "active" as const,
    color: "linear-gradient(135deg, hsl(174 84% 40%) 0%, hsl(190 84% 50%) 100%)",
  },
  {
    name: "Marketing Campaign",
    description: "Q1 digital marketing strategy and execution",
    progress: 100,
    members: 3,
    status: "completed" as const,
    color: "linear-gradient(135deg, hsl(38 92% 50%) 0%, hsl(25 95% 53%) 100%)",
  },
  {
    name: "API Integration",
    description: "Third-party service integrations and documentation",
    progress: 20,
    members: 4,
    status: "paused" as const,
    color: "linear-gradient(135deg, hsl(142 76% 36%) 0%, hsl(160 84% 39%) 100%)",
  },
];

const activities = [
  { user: "Sarah Chen", action: "completed task", target: "Design homepage mockup", time: "2 minutes ago", avatar: "SC" },
  { user: "Mike Johnson", action: "commented on", target: "API documentation", time: "15 minutes ago", avatar: "MJ" },
  { user: "Emma Wilson", action: "created project", target: "Q2 Planning", time: "1 hour ago", avatar: "EW" },
  { user: "Alex Kumar", action: "uploaded files to", target: "Brand Assets", time: "2 hours ago", avatar: "AK" },
];

const tasks = [
  { id: "1", title: "Review design specifications", project: "Website Redesign", priority: "high" as const, completed: false, dueDate: "Today" },
  { id: "2", title: "Setup CI/CD pipeline", project: "Mobile App", priority: "medium" as const, completed: false, dueDate: "Tomorrow" },
  { id: "3", title: "Write API documentation", project: "API Integration", priority: "low" as const, completed: true, dueDate: "Feb 5" },
  { id: "4", title: "User testing session", project: "Website Redesign", priority: "high" as const, completed: false, dueDate: "Feb 6" },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <main className="ml-64 min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="flex items-center justify-between px-8 py-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Welcome back, here's what's happening</p>
            </div>
            
            <div className="flex items-center gap-4">
              <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
                <Bell className="w-5 h-5 text-muted-foreground" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-status-error rounded-full" />
              </button>
              
              <button className="flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg hover:bg-muted transition-colors">
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
                  JD
                </div>
                <span className="text-sm font-medium text-foreground">John Doe</span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </header>

        <div className="p-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard
              title="Total Projects"
              value={12}
              change="+2 this month"
              changeType="positive"
              icon={FolderKanban}
              delay={0}
            />
            <StatCard
              title="Active Tasks"
              value={48}
              change="8 due today"
              changeType="neutral"
              icon={CheckSquare}
              delay={50}
            />
            <StatCard
              title="Hours Tracked"
              value="164h"
              change="+12% from last week"
              changeType="positive"
              icon={Clock}
              delay={100}
            />
            <StatCard
              title="Productivity"
              value="94%"
              change="+5% improvement"
              changeType="positive"
              icon={TrendingUp}
              delay={150}
            />
          </div>

          {/* Projects Section */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-foreground">Active Projects</h2>
              <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                View all →
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {projects.map((project, index) => (
                <ProjectCard key={project.name} {...project} delay={index * 50} />
              ))}
            </div>
          </section>

          {/* Tasks and Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Tasks */}
            <div className="lg:col-span-2 bg-card rounded-xl p-6 shadow-soft">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-card-foreground">Upcoming Tasks</h2>
                <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                  Add task
                </button>
              </div>
              <TaskList tasks={tasks} />
            </div>

            {/* Recent Activity */}
            <div className="bg-card rounded-xl p-6 shadow-soft">
              <h2 className="text-lg font-semibold text-card-foreground mb-4">Recent Activity</h2>
              <div className="divide-y divide-border">
                {activities.map((activity, index) => (
                  <ActivityItem key={index} {...activity} delay={index * 50} />
                ))}
              </div>
              <button className="w-full mt-4 text-sm font-medium text-primary hover:text-primary/80 transition-colors text-center py-2">
                View all activity
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
