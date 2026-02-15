/**
 * ContactMatcher - Shared contact matching utility
 *
 * Matches transcribed speech against a contacts list.
 * Used by IvrTransferAssistant and DirectDialAssistant.
 *
 * Contact format expected:
 * { contacts: [{ phone: "+123", words: ["john", "doe"] }, ...] }
 */

interface Contact {
  phone: string;
  words: string[];
}

interface ContactsData {
  contacts: Contact[];
}

class ContactMatcher {
  private contacts: ContactsData | null;

  constructor(contacts: ContactsData | undefined) {
    this.contacts = contacts ?? null;
  }

  /**
   * Find a phone number by matching words from transcribed text
   * against contact keywords.
   *
   * Returns the matched phone number or "no-match".
   */
  findNumberByWords(searchWords: string): string {
    if (!this.contacts || !this.contacts.contacts) return "no-match";

    const cleanedWords = searchWords
      .toLowerCase()
      .split(" ")
      .filter((word: string) => word !== "")
      .map((word: string) => word.split(".").join(""));

    for (const contact of this.contacts.contacts) {
      const { phone, words } = contact;

      const matchFound = words.some((contactWord: string) => {
        return cleanedWords.find(
          (word: string) => word === contactWord.toLowerCase()
        );
      });

      if (matchFound) {
        return phone;
      }
    }

    return "no-match";
  }
}

module.exports.ContactMatcher = ContactMatcher;
export type { Contact, ContactsData };
