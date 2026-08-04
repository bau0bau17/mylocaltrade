import React, { useState } from 'react';
import { Search, MapPin, User, ChevronDown, CheckCircle, Shield, Star, MessageSquare, ArrowRight, Droplet, Zap, Home, Thermometer, Wind, Layers, Wrench, Settings, Send, Compass } from 'lucide-react';

export default function MobileHomeRefined() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const categories = [
    { name: 'Plumbing', icon: Droplet, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { name: 'Electrical', icon: Zap, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    { name: 'Roofing', icon: Home, color: 'text-rose-400', bg: 'bg-rose-400/10' },
    { name: 'Heating', icon: Thermometer, color: 'text-orange-400', bg: 'bg-orange-400/10' },
    { name: 'Heat pumps', icon: Wind, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { name: 'Insulation', icon: Layers, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
    { name: 'Maintenance', icon: Wrench, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { name: 'Handyman', icon: Settings, color: 'text-slate-400', bg: 'bg-slate-400/10' },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#0B1120] text-[#E8EDF5] font-sans selection:bg-[#00B4D8]/30 overflow-x-hidden pb-24">
      {/* Header Area */}
      <header className="sticky top-0 z-50 bg-[#111827]/80 backdrop-blur-xl border-b border-[#1E293B] px-5 pt-12 pb-5">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-8 rounded-full bg-[#00B4D8] shadow-[0_0_12px_rgba(0,180,216,0.5)]" />
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-tight text-white">MyLocalTrade</h1>
              <p className="text-xs text-[#7B8CA8] font-medium tracking-wide">UK's trusted tradespeople</p>
            </div>
          </div>
          <button className="w-10 h-10 rounded-full bg-[#1A2332] border border-[#263245] flex items-center justify-center text-[#00B4D8] transition-colors hover:bg-[#1E293B]">
            <User size={18} />
          </button>
        </div>

        {/* Location & Search Unified Block */}
        <div className="flex flex-col gap-3">
          <button className="flex items-center gap-2 w-max text-sm text-[#7B8CA8] hover:text-[#E8EDF5] transition-colors">
            <MapPin size={14} className="text-[#06D6A0]" />
            <span className="font-medium">London, UK</span>
            <ChevronDown size={14} className="opacity-70" />
          </button>
          
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-[#00B4D8]" />
            </div>
            <input 
              type="text" 
              placeholder="Search plumber, electrician..." 
              className="w-full bg-[#141B2D] border border-[#263245] text-sm text-white placeholder-[#4B5B73] rounded-2xl py-3.5 pl-11 pr-12 focus:outline-none focus:border-[#00B4D8] focus:ring-1 focus:ring-[#00B4D8] transition-all shadow-inner"
            />
            <div className="absolute inset-y-0 right-1.5 flex items-center">
              <button className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#1A2332] text-[#00B4D8] border border-[#263245] hover:bg-[#1E293B] transition-colors">
                <Compass size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 pt-6 flex flex-col gap-8">
        
        {/* Trust Badges */}
        <div className="flex justify-between items-center bg-[#141B2D] border border-[#1E293B] rounded-2xl p-4 shadow-sm">
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div className="w-8 h-8 rounded-full bg-[#06D6A0]/10 text-[#06D6A0] flex items-center justify-center">
              <CheckCircle size={16} strokeWidth={2.5} />
            </div>
            <span className="text-[11px] font-bold tracking-wide uppercase text-[#E8EDF5]">Verified</span>
          </div>
          <div className="w-px h-8 bg-[#1E293B]" />
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div className="w-8 h-8 rounded-full bg-[#00B4D8]/10 text-[#00B4D8] flex items-center justify-center">
              <Shield size={16} strokeWidth={2.5} />
            </div>
            <span className="text-[11px] font-bold tracking-wide uppercase text-[#E8EDF5]">UK Wide</span>
          </div>
          <div className="w-px h-8 bg-[#1E293B]" />
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div className="w-8 h-8 rounded-full bg-[#F59E0B]/10 text-[#F59E0B] flex items-center justify-center">
              <Star size={16} strokeWidth={2.5} />
            </div>
            <span className="text-[11px] font-bold tracking-wide uppercase text-[#E8EDF5]">Top Rated</span>
          </div>
        </div>

        {/* Request a Quote CTA */}
        <button className="relative overflow-hidden rounded-2xl group text-left">
          <div className="absolute inset-0 bg-gradient-to-br from-[#00B4D8] to-[#0077B6] z-0" />
          {/* Subtle noise/texture overlay could go here */}
          <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
          
          <div className="relative z-10 flex items-center gap-4 p-5">
            <div className="w-12 h-12 shrink-0 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/10 flex items-center justify-center shadow-lg">
              <MessageSquare size={22} className="text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-white mb-1 shadow-sm">Request a free quote</h3>
              <p className="text-xs text-white/90 leading-relaxed max-w-[200px]">
                Describe your job once and get matched with verified local pros.
              </p>
            </div>
            <div className="w-8 h-8 shrink-0 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowRight size={16} className="text-white" />
            </div>
          </div>
        </button>

        {/* Categories */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-white">Popular services</h2>
            <button className="text-[13px] font-semibold text-[#00B4D8] flex items-center gap-1 hover:text-[#00B4D8]/80 transition-colors">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {categories.map((cat, i) => (
              <button key={i} className="flex flex-col items-center gap-2 group">
                <div className={`w-14 h-14 rounded-2xl ${cat.bg} border border-[#263245] flex items-center justify-center transition-transform group-hover:scale-95`}>
                  <cat.icon size={22} className={cat.color} strokeWidth={1.5} />
                </div>
                <span className="text-[11px] font-medium text-[#7B8CA8] text-center leading-tight">
                  {cat.name}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Recent Enquiries */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-white">Recent enquiries</h2>
            <button className="text-[13px] font-semibold text-[#00B4D8] flex items-center gap-1">
              See all <ArrowRight size={12} />
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {[
              { name: 'Elite Plumbing Solutions', service: 'Boiler Repair', status: 'Replied', statusColor: 'text-[#06D6A0]', statusBg: 'bg-[#06D6A0]/10' },
              { name: 'JD Spark Electrical', service: 'Rewiring Quote', status: 'Awaiting', statusColor: 'text-[#F59E0B]', statusBg: 'bg-[#F59E0B]/10' }
            ].map((enq, i) => (
              <button key={i} className="flex items-center gap-4 bg-[#141B2D] border border-[#1E293B] rounded-2xl p-3.5 hover:border-[#263245] transition-colors text-left group">
                <div className="w-10 h-10 rounded-xl bg-[#1A2332] flex items-center justify-center border border-[#263245]">
                  <Send size={16} className="text-[#7B8CA8]" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h4 className="text-sm font-bold text-[#E8EDF5] truncate">{enq.name}</h4>
                  <p className="text-[13px] text-[#7B8CA8] truncate mt-0.5">{enq.service}</p>
                </div>
                <div className={`px-2.5 py-1 rounded-md ${enq.statusBg}`}>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${enq.statusColor}`}>{enq.status}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Featured Traders */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Featured Traders
              <span className="text-xs font-medium text-[#7B8CA8] px-2 py-0.5 bg-[#1A2332] rounded-full border border-[#263245]">London</span>
            </h2>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory hide-scrollbar -mx-5 px-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-[260px] shrink-0 snap-start bg-[#141B2D] border border-[#1E293B] rounded-2xl overflow-hidden shadow-sm">
                <div className="h-24 bg-[#1A2332] relative">
                  {/* Banner placeholder */}
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-900/40 to-cyan-900/40" />
                  <div className="absolute top-2 right-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md border border-white/10 flex items-center gap-1">
                    <Star size={10} className="text-[#F59E0B] fill-[#F59E0B]" />
                    <span className="text-[10px] font-bold text-white">4.9</span>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-0 relative">
                  <div className="w-14 h-14 rounded-xl bg-[#111827] border-2 border-[#141B2D] -mt-7 mb-2 flex items-center justify-center overflow-hidden relative shadow-sm">
                    {/* Logo placeholder */}
                    <span className="text-lg font-bold text-[#4B5B73]">T{i}</span>
                    <div className="absolute bottom-0 right-0 w-4 h-4 bg-[#06D6A0] rounded-tl-lg flex items-center justify-center">
                      <CheckCircle size={10} className="text-[#111827]" strokeWidth={3} />
                    </div>
                  </div>
                  <h3 className="text-[15px] font-bold text-white leading-tight mb-1">
                    {i === 1 ? 'AquaFlow Heating' : i === 2 ? 'Lumin Electricals' : 'ProRoof London'}
                  </h3>
                  <p className="text-xs text-[#7B8CA8] mb-3 flex items-center gap-1.5">
                    {i === 1 ? <Thermometer size={12} /> : i === 2 ? <Zap size={12} /> : <Home size={12} />}
                    {i === 1 ? 'Heating & Plumbing' : i === 2 ? 'Electrical Services' : 'Roofing Specialists'}
                  </p>
                  <button className="w-full py-2 bg-[#1A2332] hover:bg-[#1E293B] text-[#E8EDF5] text-[13px] font-semibold rounded-lg border border-[#263245] transition-colors">
                    View profile
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Bottom Nav Bar mockup */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#111827]/90 backdrop-blur-xl border-t border-[#1E293B] pb-safe pt-2 px-6">
        <div className="flex justify-between items-center h-14">
          <div className="flex flex-col items-center gap-1 text-[#00B4D8]">
            <Home size={20} strokeWidth={2.5} />
            <span className="text-[10px] font-bold">Home</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-[#4B5B73] hover:text-[#7B8CA8] transition-colors">
            <Search size={20} />
            <span className="text-[10px] font-medium">Search</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-[#4B5B73] hover:text-[#7B8CA8] transition-colors">
            <MessageSquare size={20} />
            <span className="text-[10px] font-medium">Messages</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-[#4B5B73] hover:text-[#7B8CA8] transition-colors">
            <User size={20} />
            <span className="text-[10px] font-medium">Profile</span>
          </div>
        </div>
      </div>
      
      {/* Safe area bottom padding for iPhone */}
      <div className="h-safe w-full bg-[#111827]" />
      
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          .pb-safe {
            padding-bottom: env(safe-area-inset-bottom);
          }
          .h-safe {
            height: env(safe-area-inset-bottom);
          }
        }
      `}} />
    </div>
  );
}
