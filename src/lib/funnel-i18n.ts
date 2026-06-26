// Localization dictionaries for the acquisition funnel front door (#2763):
// /support, /auth/signin, and the donate forms. Mirrors the thin-i18n pattern
// (URL-prefix locale, real `/es/*` routes) used by the homepage — these are the
// pages Instagram/webview users land on with no browser-translate affordance,
// so they get native Spanish. Deep content stays English (Google Translate).

import type { Locale } from './i18n';

// ---------- /support ----------

export interface SupportStrings {
  metaTitle: string;
  metaDescription: string;
  heroTitle: string;
  heroLeadBeforeLink: string;
  heroLeadAfterLink: string;
  statBooks: string;
  statPages: string;
  statFirst: string;
  giftTitle: string;
  giftLead: string;
  nafKicker: string;
  nafTitle: string;
  nafSub: string;
  intlKicker: string;
  efmTitle: string;
  efmSub: string;
  largeKicker: string;
  taxNote: string;
  whereTitle: string;
  whereCards: { title: string; text: string }[];
  followTitle: string;
  followLead: string;
  footerLeadBeforeLink: string;
  footerParticipate: string;
  footerLeadAfterLink: string;
  footerOrg: string;
  home: string;
  cc0: string;
}

export const SUPPORT_STRINGS: Record<Locale, SupportStrings> = {
  en: {
    metaTitle: 'Support — Source Library',
    metaDescription:
      'Support the digitization and translation of rare historical texts from the Bibliotheca Philosophica Hermetica.',
    heroTitle: 'Support Source Library',
    heroLeadBeforeLink:
      'Consider making a gift to support our work to digitize, translate, and freely publish rare historical texts. Source Library is a project of the ',
    heroLeadAfterLink: ' (ANBI-registered) in Amsterdam, with 501(c)(3) tax-deductible options.',
    statBooks: 'books digitized',
    statPages: 'pages translated',
    statFirst: 'first-ever English translations',
    giftTitle: 'Make a Gift',
    giftLead:
      "Pick a route below to give now, or use the form and we'll follow up personally. Every gift, of any size, makes a difference.",
    nafKicker: 'US tax-deductible',
    nafTitle: 'Donate via NAF',
    nafSub: '501(c)(3) public charity',
    intlKicker: 'International',
    efmTitle: 'Donate via EFM',
    efmSub: 'ANBI-registered (NL)',
    largeKicker: 'Large gifts — wire, stock, or donor-advised fund',
    taxNote:
      'US donors giving through the Netherland-America Foundation receive full 501(c)(3) tax benefits. Receipts are issued automatically via Stripe or on request.',
    whereTitle: 'Where your support goes',
    whereCards: [
      { title: 'Digitization', text: 'High-resolution scanning of fragile manuscripts and rare printed books.' },
      { title: 'Translation', text: 'AI-assisted translation of Latin, Greek, and German, with scholarly review. The largest cost.' },
      { title: 'Open platform', text: 'A free reading interface with bilingual pages, search, and image galleries.' },
    ],
    followTitle: 'Follow the work',
    followLead:
      "Not ready to give? Leave your email and we'll send word as new first-ever translations come online. No account needed.",
    footerLeadBeforeLink: 'Not everyone gives money — some give time. ',
    footerParticipate: 'Participate',
    footerLeadAfterLink: ' as a translator, reviewer, or volunteer.',
    footerOrg: 'Source Library — Embassy of the Free Mind',
    home: 'Home',
    cc0: 'CC0 Public Domain',
  },
  es: {
    metaTitle: 'Apoyar — Source Library',
    metaDescription:
      'Apoya la digitalización y traducción de textos históricos raros de la Bibliotheca Philosophica Hermetica.',
    heroTitle: 'Apoya Source Library',
    heroLeadBeforeLink:
      'Considera hacer una donación para apoyar nuestro trabajo de digitalizar, traducir y publicar gratuitamente textos históricos raros. Source Library es un proyecto de la ',
    heroLeadAfterLink: ' (registrada como ANBI) en Ámsterdam, con opciones deducibles de impuestos 501(c)(3).',
    statBooks: 'libros digitalizados',
    statPages: 'páginas traducidas',
    statFirst: 'primeras traducciones al inglés',
    giftTitle: 'Haz una donación',
    giftLead:
      'Elige una vía para donar ahora, o usa el formulario y te contactaremos personalmente. Cada donación, de cualquier tamaño, marca la diferencia.',
    nafKicker: 'Deducible en EE. UU.',
    nafTitle: 'Donar vía NAF',
    nafSub: 'Entidad benéfica 501(c)(3)',
    intlKicker: 'Internacional',
    efmTitle: 'Donar vía EFM',
    efmSub: 'Registrada como ANBI (NL)',
    largeKicker: 'Donaciones grandes — transferencia, acciones o fondo asesorado',
    taxNote:
      'Los donantes de EE. UU. que dan a través de la Netherland-America Foundation reciben todos los beneficios fiscales 501(c)(3). Los recibos se emiten automáticamente vía Stripe o a petición.',
    whereTitle: 'A dónde va tu apoyo',
    whereCards: [
      { title: 'Digitalización', text: 'Escaneo de alta resolución de manuscritos frágiles y libros impresos raros.' },
      { title: 'Traducción', text: 'Traducción asistida por IA del latín, griego y alemán, con revisión académica. El mayor coste.' },
      { title: 'Plataforma abierta', text: 'Una interfaz de lectura gratuita con páginas bilingües, búsqueda y galerías de imágenes.' },
    ],
    followTitle: 'Sigue el trabajo',
    followLead:
      '¿Aún no quieres donar? Déjanos tu correo y te avisaremos cuando se publiquen nuevas primeras traducciones. No necesitas cuenta.',
    footerLeadBeforeLink: 'No todos dan dinero — algunos dan su tiempo. ',
    footerParticipate: 'Participa',
    footerLeadAfterLink: ' como traductor, revisor o voluntario.',
    footerOrg: 'Source Library — Embassy of the Free Mind',
    home: 'Inicio',
    cc0: 'CC0 Dominio Público',
  },
};

// ---------- donate forms ----------

export interface DonateFormStrings {
  amountOptions: { value: string; label: string }[];
  routeOptions: { value: string; label: string; description: string }[];
  successTitlePrefix: string; // "Thank you, " + first name
  successBody: string;
  successInboxPrefix: string; // "Check your inbox at " + email
  title: string;
  lead: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  routeLegend: string;
  amountLabel: string;
  optional: string;
  amountPreferNot: string;
  messageLabel: string;
  messagePlaceholder: string;
  genericError: string;
  submitting: string;
  submit: string;
  reassurance: string;
}

export const DONATE_FORM_STRINGS: Record<Locale, DonateFormStrings> = {
  en: {
    amountOptions: [
      { value: 'under-1000', label: 'Under $1,000' },
      { value: '1000-5000', label: '$1,000 - $5,000' },
      { value: '5000-10000', label: '$5,000 - $10,000' },
      { value: '10000-25000', label: '$10,000 - $25,000' },
      { value: '25000-50000', label: '$25,000 - $50,000' },
      { value: '50000-plus', label: '$50,000+' },
    ],
    routeOptions: [
      { value: 'naf', label: 'US Tax-Deductible (NAF)', description: 'Via the Netherland-America Foundation, a 501(c)(3) public charity.' },
      { value: 'efm', label: 'Direct to Embassy of the Free Mind', description: 'For European and international donors. ANBI-registered in the Netherlands.' },
      { value: 'undecided', label: "I'm not sure yet", description: "We'll help you find the best option for your situation." },
    ],
    successTitlePrefix: 'Thank you, ',
    successBody:
      "We've sent you an email with next steps and a personal introduction to Derek Lomas, our Project Director, who can help with anything you need.",
    successInboxPrefix: 'Check your inbox at ',
    title: 'Express Your Interest',
    lead: "Tell us a bit about yourself and we'll follow up personally to help make your contribution as easy as possible.",
    nameLabel: 'Your name',
    namePlaceholder: 'Full name',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    routeLegend: 'How would you like to donate?',
    amountLabel: 'Approximate amount',
    optional: '(optional)',
    amountPreferNot: 'Prefer not to say',
    messageLabel: "Anything you'd like us to know?",
    messagePlaceholder: 'What draws you to this work, how you found us, or anything else...',
    genericError: 'Something went wrong. Please try again or email derek@sourcelibrary.org directly.',
    submitting: 'Sending...',
    submit: 'Get in Touch',
    reassurance: "We'll respond personally within one business day. Your information is never shared.",
  },
  es: {
    amountOptions: [
      { value: 'under-1000', label: 'Menos de $1,000' },
      { value: '1000-5000', label: '$1,000 - $5,000' },
      { value: '5000-10000', label: '$5,000 - $10,000' },
      { value: '10000-25000', label: '$10,000 - $25,000' },
      { value: '25000-50000', label: '$25,000 - $50,000' },
      { value: '50000-plus', label: '$50,000+' },
    ],
    routeOptions: [
      { value: 'naf', label: 'Deducible en EE. UU. (NAF)', description: 'A través de la Netherland-America Foundation, entidad benéfica 501(c)(3).' },
      { value: 'efm', label: 'Directo a Embassy of the Free Mind', description: 'Para donantes europeos e internacionales. Registrada como ANBI en los Países Bajos.' },
      { value: 'undecided', label: 'Aún no estoy seguro', description: 'Te ayudaremos a encontrar la mejor opción para tu situación.' },
    ],
    successTitlePrefix: 'Gracias, ',
    successBody:
      'Te hemos enviado un correo con los siguientes pasos y una presentación personal de Derek Lomas, nuestro Director de Proyecto, que puede ayudarte con lo que necesites.',
    successInboxPrefix: 'Revisa tu bandeja de entrada en ',
    title: 'Expresa tu interés',
    lead: 'Cuéntanos un poco sobre ti y te contactaremos personalmente para que tu contribución sea lo más fácil posible.',
    nameLabel: 'Tu nombre',
    namePlaceholder: 'Nombre completo',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    routeLegend: '¿Cómo te gustaría donar?',
    amountLabel: 'Cantidad aproximada',
    optional: '(opcional)',
    amountPreferNot: 'Prefiero no decirlo',
    messageLabel: '¿Algo que quieras contarnos?',
    messagePlaceholder: 'Qué te atrae de este trabajo, cómo nos encontraste, o cualquier otra cosa...',
    genericError: 'Algo salió mal. Inténtalo de nuevo o escribe directamente a derek@sourcelibrary.org.',
    submitting: 'Enviando...',
    submit: 'Ponte en contacto',
    reassurance: 'Te responderemos personalmente en un día hábil. Tu información nunca se comparte.',
  },
};

export interface QuickSubscribeStrings {
  placeholder: string;
  emailAria: string;
  subscribe: string;
  joining: string;
  success: string;
  genericError: string;
}

export const QUICK_SUBSCRIBE_STRINGS: Record<Locale, QuickSubscribeStrings> = {
  en: {
    placeholder: 'you@email.com',
    emailAria: 'Email address',
    subscribe: 'Keep me posted',
    joining: 'Joining…',
    success: "Thank you — you're on the list. We'll share new translations as they land.",
    genericError: 'Something went wrong',
  },
  es: {
    placeholder: 'tu@correo.com',
    emailAria: 'Correo electrónico',
    subscribe: 'Mantenme al tanto',
    joining: 'Uniéndote…',
    success: 'Gracias — estás en la lista. Compartiremos nuevas traducciones a medida que lleguen.',
    genericError: 'Algo salió mal',
  },
};

// ---------- /auth/signin ----------

export interface SignInStrings {
  title: string;
  subtitle: string;
  homeAria: string;
  inAppWarnBeforeApp: string; // "You're in "
  inAppWarnAfterApp: string; // "'s in-app browser, where Google sign-in is usually blocked."
  inAppWarnGeneric: string; // when app name unknown: "an in-app browser, where..."
  inAppUseEmail: string; // "Use email below"
  inAppTail: string; // "— we'll send a link... (Or tap the … menu and choose "Open in {browser}".)" with {browser}
  errOAuthNotLinked: string;
  errEmailSignin: string;
  errGeneric: string;
  errSendLink: string;
  errGoogleConnect: string;
  errCompleteVerification: string;
  emailLabel: string;
  emailPlaceholder: string;
  sendingLink: string;
  continueEmail: string;
  or: string;
  redirectingGoogle: string;
  continueGoogle: string;
  googleBlockedNote: string;
  termsPrefix: string;
  terms: string;
  and: string;
  privacy: string;
  termsSuffix: string;
  checkEmailTitle: string;
  checkEmailBodyBefore: string; // "We sent a sign-in link to "
  checkEmailBodyAfter: string; // ". Click the link to access the library."
  useDifferentEmail: string;
}

export const SIGNIN_STRINGS: Record<Locale, SignInStrings> = {
  en: {
    title: 'Sign In',
    subtitle: 'Access the full collection of rare texts in alchemy, Hermetica, and natural philosophy.',
    homeAria: 'Source Library home',
    inAppWarnBeforeApp: "You're in ",
    inAppWarnAfterApp: '’s in-app browser, where Google sign-in is usually blocked.',
    inAppWarnGeneric: "You're in an in-app browser, where Google sign-in is usually blocked.",
    inAppUseEmail: 'Use email below',
    inAppTail: "— we'll send a link that opens in your normal browser and signs you in. (Or tap the … menu and choose “Open in {browser}”.)",
    errOAuthNotLinked: 'This email is already associated with another account.',
    errEmailSignin: 'Could not send sign-in email. Please try again.',
    errGeneric: 'An error occurred during sign in. Please try again.',
    errSendLink: 'Could not send sign-in link. Please try again.',
    errGoogleConnect: 'Could not connect to Google. Please try again.',
    errCompleteVerification: 'Please complete the verification below.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    sendingLink: 'Sending link...',
    continueEmail: 'Continue with Email',
    or: 'or',
    redirectingGoogle: 'Redirecting to Google...',
    continueGoogle: 'Continue with Google',
    googleBlockedNote: 'Often blocked in in-app browsers — email is more reliable here.',
    termsPrefix: 'By signing in, you agree to our ',
    terms: 'terms of service',
    and: ' and ',
    privacy: 'privacy policy',
    termsSuffix: '.',
    checkEmailTitle: 'Check your email',
    checkEmailBodyBefore: 'We sent a sign-in link to ',
    checkEmailBodyAfter: '. Click the link to access the library.',
    useDifferentEmail: 'Use a different email',
  },
  es: {
    title: 'Iniciar sesión',
    subtitle: 'Accede a toda la colección de textos raros de alquimia, hermética y filosofía natural.',
    homeAria: 'Inicio de Source Library',
    inAppWarnBeforeApp: 'Estás en el navegador interno de ',
    inAppWarnAfterApp: ', donde el inicio de sesión con Google suele estar bloqueado.',
    inAppWarnGeneric: 'Estás en un navegador interno, donde el inicio de sesión con Google suele estar bloqueado.',
    inAppUseEmail: 'Usa el correo abajo',
    inAppTail: '— te enviaremos un enlace que se abre en tu navegador normal y te conecta. (O toca el menú … y elige «Abrir en {browser}».)',
    errOAuthNotLinked: 'Este correo ya está asociado a otra cuenta.',
    errEmailSignin: 'No se pudo enviar el correo de inicio de sesión. Inténtalo de nuevo.',
    errGeneric: 'Ocurrió un error al iniciar sesión. Inténtalo de nuevo.',
    errSendLink: 'No se pudo enviar el enlace de inicio de sesión. Inténtalo de nuevo.',
    errGoogleConnect: 'No se pudo conectar con Google. Inténtalo de nuevo.',
    errCompleteVerification: 'Por favor, completa la verificación de abajo.',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    sendingLink: 'Enviando enlace...',
    continueEmail: 'Continuar con correo',
    or: 'o',
    redirectingGoogle: 'Redirigiendo a Google...',
    continueGoogle: 'Continuar con Google',
    googleBlockedNote: 'A menudo se bloquea en navegadores internos — el correo es más fiable aquí.',
    termsPrefix: 'Al iniciar sesión, aceptas nuestros ',
    terms: 'términos de servicio',
    and: ' y la ',
    privacy: 'política de privacidad',
    termsSuffix: '.',
    checkEmailTitle: 'Revisa tu correo',
    checkEmailBodyBefore: 'Enviamos un enlace de inicio de sesión a ',
    checkEmailBodyAfter: '. Haz clic en el enlace para acceder a la biblioteca.',
    useDifferentEmail: 'Usar otro correo',
  },
};
