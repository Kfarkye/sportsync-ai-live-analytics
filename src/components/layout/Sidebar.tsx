import React from 'react';
import { LayoutDashboard, Trophy, Calendar, TrendingUp, Radio, Settings, Gamepad2 } from 'lucide-react';

interface SidebarProps {
    activeSport: string;
    onSelectSport: (sport: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeSport, onSelectSport }) => {
  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', id: 'ALL' },
    { icon: Radio, label: 'Live Now', id: 'LIVE' },
    { icon: Trophy, label: 'NBA', id: 'NBA' },
    { icon: Gamepad2, label: 'NFL', id: 'NFL' },
    { icon: TrendingUp, label: 'Soccer', id: 'SOCCER' },
    { icon: Calendar, label: 'Schedule', id: 'SCHEDULE' },
  ];

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-64px)] w-64 flex-col border-r border-zinc-800 bg-zinc-900 lg:flex">
      <div className="p-4 space-y-6">
        <div>
            <h3 className="mb-2 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Menu</h3>
            <div className="space-y-1">
            {menuItems.map((item) => (
                <button
                key={item.id}
                onClick={() => onSelectSport(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                    activeSport === item.id 
                    ? 'border border-zinc-700 bg-zinc-800 text-white' 
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
                >
                <item.icon size={18} />
                {item.label}
                {item.id === 'LIVE' && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-rose-500 live-pulse"></span>
                )}
                </button>
            ))}
            </div>
        </div>

        <div>
            <h3 className="mb-2 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">My Leagues</h3>
            <div className="space-y-1">
                {['Premier League', 'Champions League', 'EuroLeague'].map((league) => (
                    <button key={league} className="flex w-full items-center justify-between rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
                        <span>{league}</span>
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="mt-auto border-t border-zinc-800 p-4">
        <button className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100">
            <Settings size={18} />
            <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
