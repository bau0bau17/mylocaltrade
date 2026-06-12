# Ghid: text și imagini mai mari în promo video (pentru embed la dimensiuni mici)

Scop: textul și mockup-ul telefonului să rămână lizibile când video-ul promo
e redat mic / embeddat pe site.

## Principiul de bază
Tot textul folosește unități **`vw`** (viewport width) în clasele Tailwind,
ex. `text-[2vw]`. Mărimea e **proporțională cu lățimea cadrului**, nu fixă în px.
Deci ca să faci textul mai mare *relativ la cadru* (lizibil la orice dimensiune
de player), crești numărul din `text-[Xvw]`. Nu se atinge layout-ul sau animațiile.

## Unde se modifică
Fișierele scenelor:
`src/components/video/video_scenes/Scene1.tsx` … `Scene5.tsx`
Cauți clasele `text-[…vw]` și le mărești.

## Valori de referință (folosite pe MyLocalTrade)

### Scene1
- badge ("For your home"): `text-[2.8vw]`
- titlu principal (h1): `text-[8.5vw]`

### Scene2
- captions pe poze (3 buc.): `text-[2.5vw]`
- titlu (h2): `text-[6vw]`
- subtitlu ("across the UK"): `text-[4.2vw]`
- rândurile cu beneficii: `text-[3vw]`

### Scene3
- titlu ("Zero hassle / Full confidence"): `text-[7.5vw]`
- tag-uri (Verified Reviews etc.): `text-[3vw]`

### Scene4
- badge ("For Traders"): `text-[2vw]`
- titlu (h2): `text-[6.5vw]`
- descriere (p): `text-[3vw]` (+ `max-w-[38vw]`)
- nume trader (h3): `text-[2.8vw]`
- "5.0 (124 reviews)": `text-[1.9vw]`
- "New Leads": `text-[2.2vw]` / "+12 today": `text-[2.6vw]`
- "Featured Badge": `text-[2.2vw]` / "Active": `text-[1.9vw]`

### Scene5
- wordmark ("MyLocalTrade"): `text-[6.8vw]`
- tagline: `text-[3.6vw]`
- badge App Store: "Download on the" `text-[1.4vw]`, "App Store" `text-[2.5vw]`

## Telefonul cu poza aplicației (Scene3)
Mărimea telefonului e dată de containerul lui. Linia modificată:
```
className="relative w-[40vw] h-[80vw] max-h-[94vh] mt-[1vh]"
```
- `max-h-[94vh]` e cel mai important — limitează înălțimea telefonului la 94%
  din înălțimea cadrului (era `85vh`). Mai mare = telefon + screenshot mai mari.
- `mt-[1vh]` reduce spațiul de sus (era `5vh`) ca să încapă mărit.

## Regula practică (pentru orice alt promo cu aceeași structură)
1. Deschide fiecare `SceneX.tsx`.
2. Text: crește fiecare `text-[Xvw]` cu ~25–30%. Textul mic de etichetă merită
   crescut cel mai mult (e cel mai greu de citit la dimensiuni mici).
3. Telefon/imagine: crește `max-h-[…vh]` (până la ~94vh) și redu `mt`.
4. Testează la o dimensiune mică (ex. 640×360) ca să confirmi lizibilitatea și
   că nu apare overflow în scenele dense (Scene2 / Scene4). Dacă o scenă densă
   devine prea înghesuită, redu doar acolo cu ~0.2–0.3vw, fără a anula restul.
