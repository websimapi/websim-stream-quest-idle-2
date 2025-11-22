export const SKILLS = {
    woodcutting: {
        id: 'woodcutting',
        name: 'Woodcutting',
        description: 'Chop trees to gather logs for construction and firemaking.',
        icon: 'woodcutting_icon.png',
        tasks: [
            { id: 'wc_oak', name: 'Chop Oak', level: 1, duration: 5000, xp: 10 },
            { id: 'wc_willow', name: 'Chop Willow', level: 15, duration: 8000, xp: 25 },
            { id: 'wc_maple', name: 'Chop Maple', level: 30, duration: 12000, xp: 45 }
        ]
    },
    scavenging: {
        id: 'scavenging',
        name: 'Scavenging',
        description: 'Search through wastelands for valuable scrap and components.',
        icon: 'scavenging_icon.png',
        tasks: [
            { id: 'sc_trash', name: 'Sift Trash', level: 1, duration: 3000, xp: 5 },
            { id: 'sc_ruins', name: 'Explore Ruins', level: 10, duration: 10000, xp: 30 },
            { id: 'sc_tech', name: 'Salvage Tech', level: 25, duration: 20000, xp: 80 }
        ]
    },
    fishing: {
        id: 'fishing',
        name: 'Fishing',
        description: 'Cast your line to catch fish for food and trade.',
        icon: 'fishing_icon.png',
        tasks: [
            { id: 'fi_shrimp', name: 'Net Shrimp', level: 1, duration: 4000, xp: 8 },
            { id: 'fi_trout', name: 'Lure Trout', level: 20, duration: 9000, xp: 35 },
            { id: 'fi_shark', name: 'Harpoon Shark', level: 50, duration: 15000, xp: 100 }
        ]
    }
};