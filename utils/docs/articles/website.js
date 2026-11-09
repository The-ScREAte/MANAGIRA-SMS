"use strict";

// School website: the public site, its designs, and its sections and photos.
module.exports = [
  {
    slug: "school-website",
    title: "Your school website",
    topic: "School website",
    order: 1,
    summary: "Every school gets a fast, mobile-friendly public website on its own address, with online admission, events and news, and a setup checklist.",
    tags: ["school website", "public website", "web address", "seo", "online admission", "contact form"],
    featured: true,
    who: "Managers, and staff given the <strong>School Website</strong> permission.",
    intro: "Your school website lives at your own address (for example <code>riverside.managira.com</code>). It's built from what you already keep in Managira, such as your logo, contact details, events and announcements, plus the sections and photos you add. It works on every phone and is set up for search engines.",
    sections: [
      {
        title: "Open your website settings",
        steps: [
          ["Open <strong>Management</strong>, then <strong>School website</strong>.", "website-manage.webp", "Management, School website: Website setup shows what's done and what's left."],
          "<strong>Website setup</strong> at the top shows how far along you are. Select any item to jump to it. Anything not set up stays hidden from visitors.",
          "Open your website from the link at the top to see it as visitors do.",
        ],
      },
      {
        title: "What visitors see",
        list: [
          "Your welcome, photos, quick facts, programs, leadership, achievements and what families say.",
          "Events and announcements you choose to publish to the website.",
          "News articles you write.",
          "<strong>Apply</strong>, when online admission is open. See <a href=\"/legal/user-documentation/online-admission\">Online admission</a>.",
          "A contact form. Messages arrive in Website setup, and by email if you add a notification address.",
        ],
      },
      {
        title: "Make it yours",
        list: [
          "<a href=\"/legal/user-documentation/school-website-designs\">Choose a design</a>: standard, 3D or emblem.",
          "<a href=\"/legal/user-documentation/school-website-content\">Edit sections and photos</a>, and arrange the page order.",
          "Your logo, color and font come from <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>.",
        ],
      },
    ],
    faq: [
      ["Can we use our own domain name?", "Your website is at your Managira address. If you already have your own website, you can add your existing address in the website settings and link to your Managira site from it."],
      ["Will search engines find us?", "Yes. Each school website is listed for search engines with your school's name, description and location."],
    ],
    related: ["school-website-designs", "school-website-content", "online-admission", "events-announcements-notifications"],
  },
  {
    slug: "school-website-designs",
    title: "Choose a website design: standard, 3D or emblem",
    topic: "School website",
    order: 2,
    summary: "Pick a standard design, a 3D design that moves as visitors scroll, or an emblem design with your mascot or logo as a watermark. Photos stay whole.",
    tags: ["website design", "website template", "3d website", "emblem", "mascot", "watermark", "school website theme"],
    who: "Managers, and staff given the <strong>School Website</strong> permission.",
    intro: "Every design shows the same content, so you can switch at any time without retyping anything. Designs are in three groups.",
    sections: [
      {
        title: "Pick a design",
        steps: [
          ["In <strong>School website</strong>, open the design picker and choose a tab: <strong>Standard</strong>, <strong>3D</strong> or <strong>Emblem</strong>.", "website-designs.webp", "The design picker: Standard, 3D and Emblem."],
          "Select a design to preview it, then select <strong>Save design</strong>.",
        ],
      },
      {
        title: "The designs",
        table: [
          ["Group", "Design", "Looks like"],
          ["Standard", "Academy", "A full-screen opening, next steps and big numbers."],
          ["Standard", "Classic", "A wide photo banner and centered sections."],
          ["Standard", "Modern", "Your welcome beside your photos, in clean cards."],
          ["Standard", "Magazine", "A newspaper look with a lead story."],
          ["Standard", "Story", "A large photo opening and numbered chapters."],
          ["Standard", "Campus", "A side menu with your school's details."],
          ["Standard", "Spotlight", "A bold welcome in your color beside your photos."],
          ["Standard", "Minimal", "Quiet and text-first."],
          ["Standard", "Mosaic", "A grid of tiles: photos, facts and news."],
          ["3D", "Glide", "Calm and simple. Your photo tilts into place as visitors scroll."],
          ["3D", "Prism", "Glass panels, a 3D photo stack and a photo wall that straightens."],
          ["3D", "Panorama", "Full-screen scenes and a gallery that sweeps sideways."],
          ["3D", "Orbit", "Your emblem floats in 3D behind glass and turns as visitors scroll."],
          ["Emblem", "Crest", "Your emblem large behind the school's name, with a soft pattern."],
          ["Emblem", "Mascot", "A bold welcome in your color with your mascot beside it."],
        ],
        note: "3D designs move smoothly as visitors scroll. Visitors who've asked their device to reduce motion see them still, and nothing is ever hidden behind the animation.",
      },
      {
        title: "Your emblem",
        steps: [
          ["For an emblem design, choose <strong>Your emblem</strong>: <strong>Mascots &amp; symbols</strong> (eagles, lions, wolves, a shield, a book, a torch and more), your <strong>School logo</strong>, or <strong>Your image</strong>.", "website-emblem.webp", "Your emblem: one of ours, your logo, or your own image, in your school color."],
          "Choose how it shows: a soft <strong>Pattern</strong>, or <strong>One large emblem</strong>.",
          "Select <strong>Save design</strong>. The emblem is drawn in your school color.",
        ],
        tip: "For Your image, a PNG with a clear background works best.",
      },
      {
        title: "Photos are always shown whole",
        text: "Managira never crops your photos. A photo whose shape fits its frame fills it; one that doesn't (a tall portrait in a wide banner, for example) is shown in full over a soft, blurred copy of itself, so nothing important is cut off.",
      },
    ],
    related: ["school-website", "school-website-content", "customize-your-school"],
  },
  {
    slug: "school-website-content",
    title: "Edit your website's sections and photos",
    topic: "School website",
    order: 3,
    summary: "Add your welcome, quick facts, programs, leadership, achievements, testimonials, FAQs, contact details, photos and news, in the order you choose.",
    tags: ["website sections", "website photos", "gallery", "slideshow", "news", "page order", "school website content"],
    who: "Managers, and staff given the <strong>School Website</strong> permission.",
    sections: [
      {
        title: "Fill in a section",
        steps: [
          ["In <strong>School website</strong>, open a section from Website setup or the list.", "website-section.webp", "Editing a website section: fill it in, turn it on, save."],
          "Fill it in and turn it on. A section that's off, or empty, is hidden from visitors.",
          "Save. The website updates straight away.",
        ],
        table: [
          ["Section", "What to put in it"],
          ["Opening", "A short kicker and tagline over your main photo."],
          ["Quick facts", "Big numbers, for example <em>1,250 students</em> or <em>14:1 students per teacher</em>."],
          ["Welcome", "A message from your principal, with their photo."],
          ["Programs &amp; facilities", "What you offer, each with a photo."],
          ["Admissions", "The steps to join, shown with your Apply button."],
          ["Leadership", "Your leadership team."],
          ["Achievements", "Awards and milestones by year."],
          ["What families say", "Quotes from parents and students."],
          ["Questions", "Frequently asked questions and answers."],
          ["Contact", "Office hours, map and a contact form."],
        ],
      },
      {
        title: "Photos and news",
        list: [
          "Add photos to the <strong>slideshow</strong> (the opening) and the <strong>gallery</strong>, each with a caption.",
          "Write <strong>news</strong> articles; the newest appear first.",
          "Events and announcements you publish to the website appear on their own.",
        ],
        tip: "Use bright, landscape photos for the slideshow. Portrait photos are still shown whole, never cropped.",
      },
      {
        title: "Arrange the page",
        text: "Use <strong>Page order</strong> to drag sections into the order you want, and turn sections on or off. The <strong>Manage</strong> link beside events and announcements opens Events, announcements &amp; activities.",
      },
    ],
    related: ["school-website", "school-website-designs", "events-announcements-notifications"],
  },
];
