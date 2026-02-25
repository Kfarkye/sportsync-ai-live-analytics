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
    <aside className="hidden lg:flex flex-col w-64 border-r border-slate-800 bg-slate-900 h-[calc(100vh-64px)] sticky top-16">
      <div className="p-4 space-y-6">
        <div>
            <h3 className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Menu</h3>
            <div className="space-y-1">
            {menuItems.map((item) => (
                <button
                key={item.id}
                onClick={() => onSelectSport(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    activeSport === item.id 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
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
            <h3 className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">My Leagues</h3>
            <div className="space-y-1">
                {['Premier League', 'Champions League', 'EuroLeague'].map((league) => (
                    <button key={league} className="w-full flex items-center justify-between px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-900 hover:bg-slate-800 transition-colors">
                        <span>{league}</span>
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="mt-auto p-4 border-t border-slate-800">
        <button className="flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-slate-900 transition-colors">
            <Settings size={18} />
            <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
