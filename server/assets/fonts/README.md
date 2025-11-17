# Proxima Nova Fonts voor PDF Export

Om Proxima Nova in PDF exports te gebruiken, plaats de volgende font bestanden in deze directory:

## Benodigde bestanden:

1. **ProximaNova-Regular.ttf** - Voor normale tekst
2. **ProximaNova-Bold.ttf** - Voor vetgedrukte tekst (koppen, etc.)
3. **ProximaNova-Italic.ttf** - Voor cursieve tekst (optioneel)
4. **ProximaNova-BoldItalic.ttf** - Voor vet-cursieve tekst (optioneel)

## Waar vind je deze fonts?

- Als je een Proxima Nova licentie hebt, download de .ttf bestanden van je font leverancier
- Of gebruik Adobe Fonts als je een Creative Cloud abonnement hebt
- Of gebruik een alternatieve gratis font zoals Inter of Roboto

## Alternatief: Gratis fonts

Als je geen Proxima Nova licentie hebt, kun je ook een gratis alternatief gebruiken:

### Inter (moderne, schone sans-serif):
Download van: https://fonts.google.com/specimen/Inter

### Roboto (populaire Google font):
Download van: https://fonts.google.com/specimen/Roboto

Hernoem deze bestanden dan naar het verwachte formaat (bijv. Inter-Regular.ttf → ProximaNova-Regular.ttf)
of pas de font configuratie aan in `server/services/pdf-fonts.ts`.

## Installatie

Na het plaatsen van de font bestanden, herstart de development server:
```bash
npm run dev
```

De PDF generator zal automatisch de fonts detecteren en gebruiken.
