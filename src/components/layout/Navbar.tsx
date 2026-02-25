import React from 'react';
import { Search, Bell, User, Menu, Zap, Bot } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { NeuralPulse } from '../ChatWidget';

const Navbar: React.FC = () => {
  const { isGlobalChatOpen, toggleGlobalChat } = useAppStore();

  return (
    <nav className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-4 lg:px-8 sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <button className="text-slate-400 hover:text-slate-900 lg:hidden">
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-tr from-emerald-500 to-blue-600 rounded-lg flex items-center justify-center">
            <Zap size={20} className="text-slate-900 fill-current" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight">
            SportSync<span className="text-emerald-500">.AI</span>
          </span>
        </div>
      </div>

      <div className="hidden md:flex flex-1 max-w-md mx-8 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
        <input
          type="text"
          placeholder="Search teams, players, or matches..."
          className="w-full bg-slate-950 border border-slate-800 rounded-full py-2 pl-10 pr-4 text-sm text-slate-300 focus:outline-none focus:border-emerald-500/50 transition-colors"
        />
      </div>

      <div className="flex items-center gap-4">
        {/* Analyst / System Oracle Trigger */}
        <button
          onClick={() => toggleGlobalChat()}
          className="relative p-2 text-slate-400 hover:text-slate-900 transition-all duration-300 group"
        >
          {isGlobalChatOpen ? (
            <NeuralPulse size={20} active className="relative z-10" />
          ) : (
            <Bot size={22} className="relative z-10" />
          )}
          {isGlobalChatOpen && (
            <span className="absolute inset-0 bg-brand-cyan/10 rounded-lg border border-brand-cyan/20 animate-pulse" />
          )}
        </button>

        <button className="relative p-2 text-slate-400 hover:text-slate-900 transition-colors">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
        </button>
        <div className="h-8 w-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden cursor-pointer hover:border-emerald-500 transition-colors">
          <User size={18} className="text-slate-400" />
        </div>
        <div className="hidden lg:flex flex-col text-right">
          <span className="text-xs font-semibold text-slate-900">Guest User</span>
          <span className="text-[10px] text-emerald-400 font-mono">$1,240.50</span>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
