import React from 'react';
import { Bell, User, Menu, Zap, Bot } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { NeuralPulse } from '../ChatWidget';

const Navbar: React.FC = () => {
  const { isGlobalChatOpen, toggleGlobalChat } = useAppStore();

  return (
    <nav className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur-md lg:px-8">
      <div className="flex items-center gap-4">
        <button className="text-zinc-400 transition-colors hover:text-zinc-100 lg:hidden">
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-tr from-emerald-500 to-blue-600">
            <Zap size={20} className="fill-current text-zinc-900" />
          </div>
          <span className="bg-linear-to-r from-white to-zinc-400 bg-clip-text text-xl font-bold tracking-tight text-transparent">
            SportSync<span className="text-emerald-500">.AI</span>
          </span>
        </div>
      </div>

      <div className="relative mx-8 hidden flex-1 md:block" />

      <div className="flex items-center gap-4">
        {/* Analyst / System Oracle Trigger */}
        <button
          onClick={() => toggleGlobalChat()}
          className="group relative p-2 text-zinc-400 transition-all duration-300 hover:text-zinc-100"
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

        <button className="relative p-2 text-zinc-400 transition-colors hover:text-zinc-100">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
        </button>
        <div className="flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 transition-colors hover:border-emerald-500">
          <User size={18} className="text-zinc-300" />
        </div>
        <div className="hidden lg:flex flex-col text-right">
          <span className="text-xs font-semibold text-zinc-100">Guest User</span>
          <span className="text-[10px] text-emerald-400 font-mono">$1,240.50</span>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
