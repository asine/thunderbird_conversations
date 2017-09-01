/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Thunderbird Conversations
 *
 * The Initial Developer of the Original Code is
 *  Jonathan Protzenko <jonathan.protzenko@gmail.com>
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Patrick Brunschwig <patrick@enigmail.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = [];

/*
 * A typical "Thunderbird conversations" plugin would be as follows:
 *
 * - An overlay.xul that overlays whatever is loaded at startup (say,
 *   messenger.xul), with a <script> in it that reads
 *
 *    Components.utils.import("resource://yourext/conv-plugin.js");
 *
 * - The main work will happen in conv-plugin.js. For instance:
 *
 *    var EXPORTED_SYMBOLS = [];
 *
 *    let hasConversations;
 *    try {
 *      Components.utils.import("resource://conversations/modules/hook.js");
 *      hasConversations = true;
 *    } catch (e) {
 *      hasConversations = false;
 *    }
 *    if (hasConversations)
 *      registerHook({
 *        // your functions here
 *      });
 *
 * That way, your conv-plugin.js won't export anything and AMO won't bother you.
 */

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/Services.jsm"); // https://developer.mozilla.org/en/JavaScript_code_modules/Services.jsm
Cu.import("resource:///modules/StringBundle.js"); // for StringBundle
Cu.import("resource://conversations/modules/stdlib/msgHdrUtils.js");
Cu.import("resource://conversations/modules/stdlib/misc.js");
Cu.import("resource://conversations/modules/stdlib/compose.js");
Cu.import("resource://conversations/modules/misc.js");
Cu.import("resource://conversations/modules/hook.js");
Cu.import("resource://conversations/modules/log.js");

let strings = new StringBundle("chrome://conversations/locale/message.properties");

let Log = setupLogging("Conversations.Modules.Enigmail");

// This is an example of a "Thunderbird Conversations" plugin. This is how one
//  is expected to interact with the plugin. As an example, we add an extra
//  Enigmail compatibility layer to make sure we use Enigmail to decrypt
//  messages whenever possible.
// If you need to listen to more events (conversation loaded, conversation
//  wiped)... just ask!

// Enigmail support, thanks to Patrick Brunschwig!
let window = getMail3Pane();
let hasEnigmail;
try {
  Cu.import("resource://enigmail/core.jsm");
  Cu.import("resource://enigmail/data.jsm");
  Cu.import("resource://enigmail/dialog.jsm");
  Cu.import("resource://enigmail/prefs.jsm");
  Cu.import("resource://enigmail/locale.jsm");
  hasEnigmail = true;
  Log.debug("Enigmail plugin for Thunderbird Conversations loaded!");
} catch (e) {
  hasEnigmail = false;
  Log.debug("Enigmail is older than 1.9 or doesn't seem to be installed...");
  try {
    Cu.import("resource://enigmail/enigmailCommon.jsm");
    Cu.import("resource://enigmail/commonFuncs.jsm");
    hasEnigmail = true;
    Log.debug("Enigmail plugin for Thunderbird Conversations loaded!");
  } catch (e) {
    hasEnigmail = false;
    Log.debug("Enigmail doesn't seem to be installed...");
  }
}


let enigmailSvc;
// used in enigmailMsgComposeOverlay.js
let gMsgCompose = {
  compFields: {}
};
let gSMFields = {};
let global = this;

if (hasEnigmail) {
  if (!global.EnigmailCore) {
    global.EnigmailCore = EnigmailCommon;
  }
  if (!global.EnigmailData) {
    global.EnigmailData = EnigmailCommon;
  }
  if (!global.EnigmailDialog) {
    global.EnigmailDialog = EnigmailCommon;
  }
  if (!global.EnigmailPrefs) {
    global.EnigmailPrefs = EnigmailCommon;
  }
  if (!global.EnigmailLocale) {
    global.EnigmailLocale = EnigmailCommon;
  }
  enigmailSvc = EnigmailCore.getService(window);
  if (!enigmailSvc) {
    Log.debug("Error loading the Enigmail service. Is Enigmail disabled?\n");
    hasEnigmail = false;
  }
  try {
    let loader = Services.scriptloader;
    loader.loadSubScript("chrome://enigmail/content/enigmailMsgComposeOverlay.js", global);
    loader.loadSubScript("chrome://enigmail/content/enigmailMsgComposeHelper.js", global);
  } catch (e) {
    hasEnigmail = false;
    Log.debug("Enigmail script doesn't seem to be loaded. Error: " + e);
  }
  if (!global.EnigmailConstants) {
    global.EnigmailConstants = EnigmailCommon;
  }

  let w = getMail3Pane();
  let iframe = w.document.createElement("iframe");
  iframe.addEventListener("load", function () {
    iframe.parentNode.removeChild(iframe);
  }, true);
  iframe.setAttribute("src", "enigmail:dummy");
  iframe.style.display = "none";
  w.document.getElementById("messagepane").appendChild(iframe);

  // Override updateSecurityStatus for showing security info properly
  // when plural messages in a thread are streamed at one time.
  let messagepane = w.document.getElementById("messagepane");
  messagepane.addEventListener("load", function _overrideUpdateSecurity() {
    messagepane.removeEventListener("load", _overrideUpdateSecurity, true);
    let w = getMail3Pane();
    // lastMsgWindow is needed to call updateSecurityStatus in mimeVerify.jsm.
    w.EnigmailVerify.lastMsgWindow = w.msgWindow;
    w.messageHeaderSink.enigmailPrepSecurityInfo();

    // EnigMimeHeaderSink.prototype in enigmailMsgHdrViewOverlay.js
    let enigMimeHeaderSinkPrototype =
      Object.getPrototypeOf(w.messageHeaderSink.securityInfo);
    let originalUpdateSecurityStatus = enigMimeHeaderSinkPrototype.updateSecurityStatus;
    // Called after decryption or verification is completed.
    // Security status of a message is updated and shown at the status bar
    // and the header box.
    enigMimeHeaderSinkPrototype
      .updateSecurityStatus = function _updateSecurityStatus_patched(unusedUriSpec, exitCode,
        statusFlags, keyId, userId, sigDetails, errorMsg, blockSeparation, uri, encToDetails) {
      // Use original if the classic reader is used.
      if (messagepane.contentDocument.location.href !== "about:blank?") {
        originalUpdateSecurityStatus.apply(this, arguments);
        return;
      }
      let message;
      let msgHdr = uri.QueryInterface(Ci.nsIMsgMessageUrl).messageHeader;
      let uriSpec = msgHdrGetUri(msgHdr);
      if (w._currentConversation) {
        for (let x of w._currentConversation.messages) {
          if (x.message._uri == uriSpec) {
            message = x.message;
            break;
          }
        }
      }
      if (!message) {
        Log.error("Message for the security info not found!");
        return;
      }
      if (message._updateHdrIcons) {
        // _updateHdrIcons is assgined if this is called before.
        // This function will be called twice a PGP/MIME encrypted message.
        return;
      }

      // Non-encrypted message may have decrypted labela since
      // message.isEncrypted is true for only signed pgp/mime message.
      // We reset decrypted label from decryption status.
      if (statusFlags & Ci.nsIEnigmail.DECRYPTION_OKAY)
        message._domNode.classList.add("decrypted");
      else
        message._domNode.classList.remove("decrypted");

      let updateHdrIcons = function () {
        w.Enigmail.hdrView.updateHdrIcons(exitCode, statusFlags, keyId, userId, sigDetails,
          errorMsg, blockSeparation, encToDetails,
          null); // xtraStatus
      };
      showHdrIconsOnStreamed(message, updateHdrIcons);

      // Show signed label of encrypted and signed pgp/mime.
      addSignedLabel(statusFlags, message._domNode, message);
    }
  }, true);
}

function tryEnigmail(aDocument, aMessage, aMsgWindow) {
  let bodyElement = aDocument.body;
  let findStr = "-----BEGIN PGP";
  let msgText = null;
  let foundIndex = -1;
  if (bodyElement.firstChild) {
    let node = bodyElement.firstChild;
    while (node) {
      if (node.nodeName == "DIV") {
        foundIndex = node.textContent.indexOf(findStr);

        if (foundIndex >= 0) {
          if (node.textContent.indexOf(findStr + " LICENSE AUTHORIZATION") == foundIndex)
            foundIndex = -1;
        }
        if (foundIndex >= 0) {
          bodyElement = node;
          break;
        }
      }
      node = node.nextSibling;
    }
  }
  if (foundIndex < 0)
    return null;

  Log.debug("Found inline PGP");

  var signatureObj = {};
  var exitCodeObj = {};
  var statusFlagsObj = {};
  var keyIdObj = {};
  var userIdObj = {};
  var sigDetailsObj = {};
  var errorMsgObj = {};
  var encToDetailsObj = {};
  var blockSeparationObj = {
    value: ""
  };

  try {
    // extract text preceeding and/or following armored block
    // strip "- show quoted text -" from body text
    let NodeFilter = window.NodeFilter;
    let treeWalker = aDocument.createTreeWalker(
      bodyElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      { acceptNode: function (node) {
          if (node.nodeType == node.ELEMENT_NODE) {
            if (node.classList.contains("showhidequote")) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let text = [];
    while (treeWalker.nextNode())
      text.push(treeWalker.currentNode.nodeValue);
    msgText = text.join('');
    msgText = msgText.replace(/\r\n?/g, "\n");

    var charset = aMsgWindow ? aMsgWindow.mailCharacterSet : "";
    Log.debug("charset=" + charset);

    // Encode ciphertext to charset from unicode
    msgText = EnigmailData.convertFromUnicode(msgText, charset);

    var mozPlainText = bodyElement.innerHTML.search(/class=\"moz-text-plain\"/);

    if ((mozPlainText >= 0) && (mozPlainText < 40)) {
      // workaround for too much expanded emoticons in plaintext msg
      var r = new RegExp(/( )(;-\)|:-\)|;\)|:\)|:-\(|:\(|:-\\|:-P|:-D|:-\[|:-\*|\>:o|8-\)|:-\$|:-X|\=-O|:-\!|O:-\)|:\'\()( )/g);
      if (msgText.search(r) >= 0) {
        msgText = msgText.replace(r, "$2");
      }
    }

    let retry = (charset != "UTF-8" ? 1 : 2);

    // extract text preceeding and/or following armored block
    var head = "";
    var tail = "";
    if (findStr) {
      head = msgText.substring(0, msgText.indexOf(findStr)).replace(/^[\n\r\s]*/, "");
      head = head.replace(/[\n\r\s]*$/, "");
      var endStart = msgText.indexOf("-----END PGP");
      var nextLine = msgText.substring(endStart).search(/[\n\r]/);
      if (nextLine > 0) {
        tail = msgText.substring(endStart + nextLine).replace(/^[\n\r\s]*/, "");
      }
    }
    if (msgText.indexOf("\nCharset:") > 0) {
      // Check if character set needs to be overridden
      var startOffset = msgText.indexOf("-----BEGIN PGP ");

      if (startOffset >= 0) {
        var subText = msgText.substr(startOffset);
        subText = subText.replace(/\r\n?/g, "\n");

        var endOffset = subText.search(/\n\n/);
        if (endOffset > 0) {
          subText = subText.substr(0, endOffset) + "\n";

          let matches = subText.match(/\nCharset: *(.*) *\n/i);
          if (matches && (matches.length > 1)) {
            // Override character set
            charset = matches[1];
            Log.debug("OVERRIDING charset=" + charset);
          }
        }
      }
    }

    var plainText =
      enigmailSvc.decryptMessage(window, 0, msgText,
        signatureObj, exitCodeObj,
        statusFlagsObj, keyIdObj, userIdObj, sigDetailsObj,
        errorMsgObj, blockSeparationObj, encToDetailsObj);

    let exitCode = exitCodeObj.value;
    if (plainText === "" && exitCode === 0) {
      plainText = " ";
    }
    if (!plainText) {
      return statusFlagsObj.value;
    }
    if (retry >= 2) {
      plainText = EnigmailData.convertFromUnicode(EnigmailData.convertToUnicode(plainText, "UTF-8"), charset);
    }
    if (blockSeparationObj.value.indexOf(" ") >= 0) {
      let blocks = blockSeparationObj.value.split(/ /);
      let blockInfo = blocks[0].split(/:/);
      plainText = EnigmailData.convertFromUnicode(EnigmailLocale.getString("notePartEncrypted"), charset) +
        "\n\n" + plainText.substr(0, blockInfo[1]) + "\n\n" + EnigmailLocale.getString("noteCutMessage");
    }

    var msgRfc822Text = "";
    if (head || tail) {
      if (head) {
        // print a warning if the signed or encrypted part doesn't start
        // quite early in the message
        let matches = head.match(/(\n)/g);
        if (matches && matches.length > 10) {
          msgRfc822Text = EnigmailData.convertFromUnicode(EnigmailLocale.getString("notePartEncrypted"), charset) + "\n\n";
        }
        msgRfc822Text += head + "\n\n";
      }
      msgRfc822Text += EnigmailData.convertFromUnicode(EnigmailLocale.getString("beginPgpPart"), charset) + "\n\n";
    }
    msgRfc822Text += plainText;
    if (head || tail) {
      msgRfc822Text += "\n\n" + EnigmailData.convertFromUnicode(EnigmailLocale.getString("endPgpPart"), charset) + "\n\n" + tail;
    }

    if (exitCode == 0) {
      if (msgRfc822Text.length > 0) {
        let node = bodyElement.querySelector("div.moz-text-plain");
        // If there's no suitable node to put the decrypted text in, create one
        // for ourselves... (happends with messages sent as html, duh).
        if (!node) {
          while (bodyElement.firstChild)
            bodyElement.removeChild(bodyElement.firstChild);
          let pre = bodyElement.ownerDocument.createElement("pre");
          bodyElement.appendChild(pre);
          node = pre;
        }
        msgRfc822Text = EnigmailData.convertToUnicode(msgRfc822Text, charset);
        node.innerHTML = EnigmailFuncs.formatPlaintextMsg(msgRfc822Text);
        aMessage.decryptedText = msgRfc822Text;
      }
    } else {
      Log.error("Enigmail error: "+exitCode+" --- "+errorMsgObj.value+"\n");
    }
    let w = topMail3Pane(aMessage);
    showHdrIconsOnStreamed(aMessage, function () {
      w.Enigmail.hdrView.updateHdrIcons(exitCode, statusFlagsObj.value,
        keyIdObj.value, userIdObj.value, sigDetailsObj.value, errorMsgObj.value,
        blockSeparationObj.value, encToDetailsObj.value);
    });
    return statusFlagsObj.value;
  } catch (ex) {
    dumpCallStack(ex);
    Log.error("Enigmail error: "+ex+" --- "+errorMsgObj.value+"\n");
    return null;
  }
}

// Verify PGP/MIME messages attachment signature.
function verifyAttachments(aMessage) {
  let { _attachments: attachments, _uri: uri, contentType: contentType } = aMessage;
  let w = topMail3Pane(aMessage);
  if ((contentType+"").search(/^multipart\/signed(;|$)/i) == 0) {
    w.Enigmail.msg.messageDecryptCb(null, true, {
      headers: {'content-type': contentType },
      contentType: contentType,
      parts: null,
    });
    return;
  }
  if ((contentType+"").search(/^multipart\/mixed(;|$)/i) != 0)
    return;
  let embeddedSigned;
  for (let x of attachments) {
    if (x.contentType.search(/application\/pgp-signature/i) >= 0) {
      embeddedSigned = x.url.replace(/(\.\d+){1,2}&filename=.*$/, "");
      break;
    }
  }
  if (!embeddedSigned)
    return;
  let mailNewsUrl = w.Enigmail.msg.getCurrentMsgUrl();
  mailNewsUrl.spec = embeddedSigned;
  w.Enigmail.msg.verifyEmbeddedMsg(w, mailNewsUrl, w.msgWindow, uri,
    null, null);
}

// Prepare for showing security info later
function prepareForShowHdrIcons(aMessage) {
  let w = topMail3Pane(aMessage);
  let conversation = aMessage._conversation;

  // w.Conversations.currentConversation is assined when conversation
  // _onComplete(), but we need currentConversation in
  // updateSecurityStatus() which is possible to be called before
  // _onComplete().
  w._currentConversation = conversation;
}

// Show signed status in the notification bar.
// Click event of Details button is set.
function showNotificationBar(aMessage) {
  let w = topMail3Pane(aMessage);
  let enigmailBar = aMessage._domNode.querySelector(".enigmailBar");
  if (enigmailBar.style.display === "block")
    return;
  let signed = w.Enigmail.hdrView.statusBar.getAttribute("signed");
  if (signed) {
    enigmailBar.classList.add(signed);
    let message = escapeHtml(w.Enigmail.msg.securityInfo.statusLine);
    if (w.Enigmail.msg.securityInfo.statusArr.length > 0) {
      message += "<br/>" + escapeHtml(w.Enigmail.msg.securityInfo.statusArr[0]);
    }
    enigmailBar.querySelector(".enigmailMessage").innerHTML = message;
    enigmailBar.style.display = "block";
    let button = enigmailBar.querySelector(".enigmailDetails button");
    button.addEventListener("click", function (event) {
      w.Enigmail.msg.viewSecurityInfo(event);
    }, false);
  }
}

// Update security info display of the message.
function updateSecurityInfo(aMessage) {
  let w = topMail3Pane(aMessage);
  w.Enigmail.hdrView.statusBarHide();
  if (aMessage._updateHdrIcons) {
    aMessage._updateHdrIcons();
  }
}

// Show security info only if the message is focused.
function showHdrIconsOnStreamed(aMessage, updateHdrIcons) {
  let w = topMail3Pane(aMessage);
  let { _domNode: node, _conversation: conversation } = aMessage;
  let focused = (node == node.ownerDocument.activeElement);
  if (!focused) {
    let focusThis = conversation._tellMeWhoToScroll();
    focused = (aMessage == conversation.messages[focusThis].message);
  }
  w.Enigmail.hdrView.statusBarHide();
  updateHdrIcons();
  showNotificationBar(aMessage);
  if (!focused) {
    w.Enigmail.hdrView.statusBarHide();
  }
  // Prepare for showing on focus.
  aMessage._updateHdrIcons = updateHdrIcons;
}

// Override treeController defined in enigmailMessengerOverlay.js
// not to hide status bar when multiple messages are selected.
// Remove unwanted event listeners.
function patchForShowSecurityInfo(aWindow) {
  let w = aWindow;
  if (w._newTreeController)
    return;

  let oldTreeController =
    w.top.controllers.getControllerForCommand("button_enigmail_decrypt");
  w.top.controllers.removeController(oldTreeController);
  let treeController = {};
  for ([i, x] of entries(oldTreeController)) {
    treeController[i] = x;
  }
  treeController.isCommandEnabled = function () {
    if (w.gFolderDisplay.messageDisplay.visible) {
      if (w.gFolderDisplay.selectedCount == 0) {
        w.Enigmail.hdrView.statusBarHide();
      }
      return (w.gFolderDisplay.selectedCount == 1);
    }
    w.Enigmail.hdrView.statusBarHide();
  };
  w.top.controllers.appendController(treeController);
  w._newTreeController = treeController;

  // Event listeners are added in enigmailMsgHdrViewOverlay.js,
  // but not needed. These display security info incorrectly when
  // resizing message view.
  w.removeEventListener('messagepane-hide', w.Enigmail.hdrView.msgHdrViewHide, true);
  w.removeEventListener('messagepane-unhide', w.Enigmail.hdrView.msgHdrViewUnide, true);
}

// Add click event to view security information.
// The event is added to decrypted and signed tags.
function addViewSecurityInfoEvent(aMessage) {
  if (aMessage._viewSecurityInfo)
    return;
  let w = getMail3Pane();
  aMessage._viewSecurityInfo = function (event) {
    // Open alert dialog which contains security info.
    w.Enigmail.msg.viewSecurityInfo(event);
  };
  for (let x of ["decrypted", "signed"]) {
    let tag = aMessage._domNode.querySelector(".keep-tag.tag-" + x);
    tag.addEventListener("click", aMessage._viewSecurityInfo, false);
    tag.style.cursor = "pointer";
  }
}

// Add signed label and click action to a signed message.
function addSignedLabel(aStatus, aDomNode, aMessage) {
  if (aStatus & (Ci.nsIEnigmail.BAD_SIGNATURE |
      Ci.nsIEnigmail.GOOD_SIGNATURE |
      Ci.nsIEnigmail.EXPIRED_KEY_SIGNATURE |
      Ci.nsIEnigmail.EXPIRED_SIGNATURE |
      Ci.nsIEnigmail.UNVERIFIED_SIGNATURE |
      Ci.nsIEnigmail.REVOKED_KEY |
      Ci.nsIEnigmail.EXPIRED_KEY_SIGNATURE |
      Ci.nsIEnigmail.EXPIRED_SIGNATURE)) {
    aDomNode.classList.add("signed");
    addViewSecurityInfoEvent(aMessage);
  }
  if (aStatus & Ci.nsIEnigmail.UNVERIFIED_SIGNATURE) {
    for (let x of aDomNode.querySelectorAll(".tag-signed")) {
      x.setAttribute("title", strings.get("unknownGood"));
    };
  }
}

let enigmailHook = {
  _domNode: null,
  _originalText: null, // for restoring original text when sending message is canceled

  onMessageBeforeStreaming: function _enigmailHook_onBeforeStreaming(aMessage) {
    if (enigmailSvc) {
      let { _attachments: attachments, _msgHdr: msgHdr, _domNode: domNode } = aMessage;
      this._domNode = domNode;
      let w = topMail3Pane(aMessage);
      let hasEnc = (aMessage.contentType+"").search(/^multipart\/encrypted(;|$)/i) == 0;
      if (hasEnc && enigmailSvc.mimeInitialized && !enigmailSvc.mimeInitialized()) {
        Log.debug("Initializing EnigMime");
        w.document.getElementById("messagepane").setAttribute("src", "enigmail:dummy");
      }

      let hasSig = (aMessage.contentType+"").search(/^multipart\/signed(;|$)/i) == 0;
      for (let x of attachments) {
        if (x.contentType.search(/^application\/pgp-signature/i) == 0)
          hasSig = true;
      }
      if (hasSig)
        aMessage._domNode.classList.add("signed");

      // Current message uri should be blank to decrypt all PGP/MIME messages.
      w.Enigmail.msg.getCurrentMsgUriSpec = function () { return ""; }
      verifyAttachments(aMessage);
      prepareForShowHdrIcons(aMessage);
      patchForShowSecurityInfo(w);
    }
  },

  onMessageStreamed: function _enigmailHook_onMessageStreamed(aMsgHdr, aDomNode, aMsgWindow, aMessage) {
    let iframe = aDomNode.getElementsByTagName("iframe")[0];
    let iframeDoc = iframe.contentDocument;
    if (iframeDoc.body.textContent.length > 0 && hasEnigmail) {
      let status = tryEnigmail(iframeDoc, aMessage, aMsgWindow);
      if (status & Ci.nsIEnigmail.DECRYPTION_OKAY)
        aDomNode.classList.add("decrypted");
      if (aDomNode.classList.contains("decrypted"))
        addViewSecurityInfoEvent(aMessage);
      addSignedLabel(status, aDomNode, aMessage);
    }
  },

  onMessageBeforeSendOrPopout: function _enigmailHook_onMessageBeforeSendOrPopout(aAddress, aEditor, aStatus, aPopout, aAttachmentList, aWindow) {
    if (hasEnigmail)
      this._originalText = null;

    if (!hasEnigmail || aPopout || aStatus.canceled)
      return aStatus;

    // global window is used in Enigmail function
    window = getMail3Pane();

    const nsIEnigmail = Ci.nsIEnigmail;
    const SIGN = nsIEnigmail.SEND_SIGNED;
    const ENCRYPT = nsIEnigmail.SEND_ENCRYPTED;

    let uiFlags = nsIEnigmail.UI_INTERACTIVE;

    let identity = aAddress.params.identity
    Enigmail.msg.identity = identity;
    Enigmail.msg.enableRules = true;

    let fromAddr = identity.email;
    let userIdValue;
    // Enigmail <= 1.3.2 doesn't support getSenderUserId.
    if (Enigmail.msg.getSenderUserId) {
      userIdValue = Enigmail.msg.getSenderUserId();
    } else if (identity.getIntAttribute("pgpKeyMode") > 0) {
      userIdValue = identity.getCharAttribute("pgpkeyId");
    }
    if (userIdValue)
      fromAddr = userIdValue;

    Enigmail.msg.setOwnKeyStatus = function () {};
    Enigmail.msg.processAccountSpecificDefaultOptions();
    // Get flags from UI checkboxes.
    if (aWindow.document.getElementById("enigmail-reply-encrypt").checked) {
      Enigmail.msg.sendMode |= ENCRYPT;
    } else {
      Enigmail.msg.sendMode &= ~ENCRYPT;
    }
    if (aWindow.document.getElementById("enigmail-reply-sign").checked) {
      Enigmail.msg.sendMode |= SIGN;
    } else {
      Enigmail.msg.sendMode &= ~SIGN;
    }
    if (aWindow.document.getElementById("enigmail-reply-pgpmime").checked) {
      Enigmail.msg.sendPgpMime = true;
    } else {
      Enigmail.msg.sendPgpMime = false;
    }
    let gotSendFlags = Enigmail.msg.sendMode;
    let sendFlags = gotSendFlags;
    if (Enigmail.msg.sendPgpMime) {
      // Use PGP/MIME
      sendFlags |= nsIEnigmail.SEND_PGP_MIME;
    }
    let optSendFlags = 0;
    if (EnigmailPrefs.getPref("alwaysTrustSend")) {
      optSendFlags |= nsIEnigmail.SEND_ALWAYS_TRUST;
    }
    if (EnigmailPrefs.getPref("encryptToSelf") ||
        (sendFlags & nsIEnigmail.SAVE_MESSAGE)) {
      optSendFlags |= nsIEnigmail.SEND_ENCRYPT_TO_SELF;
    }
    sendFlags |= optSendFlags;

    let toAddrList = aAddress.to.concat(aAddress.cc)
      .map(EnigmailFuncs.stripEmail);
    let bccAddrList = aAddress.bcc.map(EnigmailFuncs.stripEmail);

    let result = Enigmail.msg.keySelection(
      enigmailSvc,
      sendFlags, // all current combined/processed send flags (incl. optSendFlags)
      optSendFlags, // may only be SEND_ALWAYS_TRUST or SEND_ENCRYPT_TO_SELF
      gotSendFlags, // initial sendMode (0 or SIGN or ENCRYPT or SIGN|ENCRYPT)
      fromAddr, toAddrList, bccAddrList);
    if (!result) {
      aStatus.canceled = true;
      return aStatus;
    }
    sendFlags = result.sendFlags;
    let toAddr = result.toAddrStr;
    let bccAddr = result.bccAddrStr;

    let statusFlagsObj = {};
    let exitCodeObj = {};
    let errorMsgObj = {};

    try {
      let origText;
      let usingPGPMime = (sendFlags & nsIEnigmail.SEND_PGP_MIME) &&
                         (sendFlags & (ENCRYPT | SIGN));

      if (!usingPGPMime && (sendFlags & ENCRYPT) &&
          aAttachmentList && aAttachmentList.attachments.length > 0) {
        // Attachments will not be encrypted using inline-PGP.
        // We switch to PGP/MIME if possible.
        if (EnigmailDialog.confirmDlg(window,
            strings.get("attachmentsNotEncrypted"),
            EnigmailLocale.getString("pgpMime_sMime.dlg.pgpMime.button"),
            EnigmailLocale.getString("dlg.button.cancel"))) {
          usingPGPMime = true;
          sendFlags |= nsIEnigmail.SEND_PGP_MIME;
        } else {
          aStatus.canceled = true;
          return aStatus;
        }
      }

      if (usingPGPMime) {
        uiFlags |= nsIEnigmail.UI_PGP_MIME;

        let newSecurityInfo = Cc[Enigmail.msg.compFieldsEnig_CID]
          .createInstance(Ci.nsIEnigMsgCompFields);
        newSecurityInfo.sendFlags = sendFlags;
        newSecurityInfo.UIFlags = uiFlags;
        newSecurityInfo.senderEmailAddr = fromAddr;
        newSecurityInfo.recipients = toAddr;
        newSecurityInfo.bccRecipients = bccAddr;
        if (Enigmail.msg.mimeHashAlgo) {
          // Enigmail < 1.5.1
          // hashAlgorithm was removed since Enigmail 1.5.1
          newSecurityInfo.hashAlgorithm =
            Enigmail.msg.mimeHashAlgo[EnigmailPrefs.getPref("mimeHashAlgorithm")];
        }
        aStatus.securityInfo = newSecurityInfo;

      } else if (sendFlags & (ENCRYPT | SIGN)) {
        // inline-PGP
        let plainText = htmlToPlainText(aEditor.value);
        let charset = "UTF-8";
        origText = aEditor.value;
        if (!(sendFlags & ENCRYPT)) {
          // Clear signing replaces preceding '-' to '- -'.
          // It produces 2 characters longer lines.
          // To prevent rewrap breaking validity of sign,
          // prepare for the case: over 70 char's long lines starting with '-'
          let width = 72;
          if (plainText.match(/^-.{70,}/m)) {
            width -= 2;
          }
          plainText = simpleWrap(plainText, width);
        }
        plainText = EnigmailData.convertFromUnicode(plainText, charset);
        let cipherText;
        if (Enigmail.msg.mimeHashAlgo) {
          // Enigmail < 1.5.1
          cipherText = enigmailSvc.encryptMessage(window, uiFlags, null,
                         plainText, fromAddr, toAddr, bccAddr,
                         sendFlags, exitCodeObj, statusFlagsObj, errorMsgObj);
        } else {
          // Third argument(hashAlgorithm) was removed since Enigmail 1.5.1
          cipherText = enigmailSvc.encryptMessage(window, uiFlags,
                         plainText, fromAddr, toAddr, bccAddr,
                         sendFlags, exitCodeObj, statusFlagsObj, errorMsgObj);
        }

        let exitCode = exitCodeObj.value;
        if (cipherText && (exitCode == 0)) {
          if ((sendFlags & ENCRYPT) && charset &&
            (charset.search(/^us-ascii$/i) != 0) ) {
            // Add Charset armor header for encrypted blocks
            cipherText = cipherText.replace(/(-----BEGIN PGP MESSAGE----- *)(\r?\n)/,
              "$1$2Charset: "+charset+"$2");
          }
          cipherText = EnigmailData.convertToUnicode(cipherText, charset);
          aEditor.value = cipherText.replace(/\r?\n/g, '<br>');
          this._originalText = origText;
        } else {
          // Encryption/signing failed
          let msg = EnigmailLocale.getString("signFailed") + "\n"
                  + errorMsgObj.value;
          aStatus.canceled = !EnigmailDialog.confirmDlg(window, msg,
            EnigmailLocale.getString("msgCompose.button.sendUnencrypted"));
          return aStatus;
        }
      }

      if ((!(sendFlags & nsIEnigmail.SAVE_MESSAGE)) &&
           EnigmailPrefs.getPref("confirmBeforeSending")) {
        if (!Enigmail.msg.confirmBeforeSend(toAddrList.join(", "), toAddr+", "+bccAddr,
             sendFlags, false)) {
          if (origText) {
            aEditor.value = origText;
          }
          aStatus.canceled = true;
          return aStatus;
        }
      }
    } catch (ex) {
      dumpCallStack(ex);
      Log.error("Enigmail encrypt error: "+ex+" --- "+errorMsgObj.value+"\n");
      let msg = EnigmailLocale.getString("signFailed");
      if (enigmailSvc && enigmailSvc.initializationError) {
        msg += "\n"+enigmailSvc.initializationError;
      }
      aStatus.canceled = !EnigmailDialog.confirmDlg(window, msg,
        EnigmailLocale.getString("msgCompose.button.sendUnencrypted"));
    }
    return aStatus;
  },

  onMessageBeforeSendOrPopout_canceled: function _enigmailHook_onMessageBeforeSendOrPopout_canceled(aAddress, aEditor, aStatus, aPopout, aAttachmentList) {
    if (hasEnigmail && !aPopout && aStatus.canceled && this._originalText !== null) {
       aEditor.value = this._originalText;
    }
  },

  onComposeSessionChanged: function _enigmailHook_onComposeSessionChanged(aComposeSession, aMessage, aAddress, aEditor, aWindow) {
    if (!hasEnigmail)
      return;

    // Show enigmail features on quick reply
    aWindow.document.querySelector(".enigmail").style.display = "inline-block";

    // Get default decrypt, sign and PGP/MIME status from settings.
    // The following code is based on enigmailMsgComposeOverlay.js.
    // Set default parameters
    Enigmail.msg.encryptForced = EnigmailConstants.ENIG_UNDEF;
    Enigmail.msg.signForced = EnigmailConstants.ENIG_UNDEF;
    Enigmail.msg.pgpmimeForced = EnigmailConstants.ENIG_UNDEF;

    // Set Enigmail.msg.sendMode from identity
    Enigmail.msg.identity = aComposeSession.params.identity;
    Enigmail.msg.setOwnKeyStatus = function () {};
    Enigmail.msg.processAccountSpecificDefaultOptions();

    // Process rules for to addresses
    let toAddrList = aAddress.to;
    if (toAddrList.length > 0 && EnigmailPrefs.getPref("assignKeysByRules")) {
      let matchedKeysObj = {};
      let flagsObj = {};
      let success;
      if (global.EnigmailRules) {
        success = EnigmailRules.mapAddrsToKeys(toAddrList.join(", "),
          false, // no interaction if not all addrs have a key
          window,
          matchedKeysObj, // resulting matching keys
          flagsObj); // resulting flags (0/1/2/3 for each type)
      } else {
        // Enigmail before 1.9
        success = Enigmail.hlp.getRecipientsKeys(toAddrList.join(", "),
          false, // not interactive
          false, // forceRecipientSettings (ignored due to not interactive)
          matchedKeysObj, // resulting matching keys
          flagsObj); // resulting flags (0/1/2/3 for each type)
      }
      if (success) {
        Enigmail.msg.encryptByRules = flagsObj.encrypt;
        Enigmail.msg.signByRules = flagsObj.sign;
        Enigmail.msg.pgpmimeByRules = flagsObj.pgpMime;

        if (matchedKeysObj.value && matchedKeysObj.value.length > 0) {
          // replace addresses with results from rules
          toAddrList = matchedKeysObj.value.split(", ");
        }
      }
    }
    // Set encryptByRules from settings
    if (toAddrList.length > 0 && EnigmailPrefs.getPref("autoSendEncrypted") == 1) {
      let validKeyList = Enigmail.hlp.validKeysForAllRecipients(toAddrList.join(", "));
      if (validKeyList) {
        Enigmail.msg.encryptByRules = EnigmailConstants.ENIG_AUTO_ALWAYS;
      }
    }

    // key function to process the final encrypt/sign/pgpmime state from all settings
    // - uses as INPUT:
    //   - Enigmail.msg.sendMode
    //   - Enigmail.msg.encryptByRules, Enigmail.msg.signByRules, Enigmail.msg.pgpmimeByRules
    //   - Enigmail.msg.encryptForced, Enigmail.msg.signForced, Enigmail.msg.pgpmimeForced
    // - uses as OUTPUT:
    //   - Enigmail.msg.statusEncrypted, Enigmail.msg.statusSigned, Enigmail.msg.statusPGPMime
    //   - Enigmail.msg.reasonEncrypted, Enigmail.msg.reasonSigned
    Enigmail.msg.processFinalState();

    let replyEncrypt = aWindow.document.getElementById("enigmail-reply-encrypt");
    let replySign = aWindow.document.getElementById("enigmail-reply-sign");
    let replyPgpMime = aWindow.document.getElementById("enigmail-reply-pgpmime");
    replyEncrypt.checked = false;
    replySign.checked = false;
    replyPgpMime.checked = false;
    switch (Enigmail.msg.statusEncrypted) {
      case EnigmailConstants.ENIG_FINAL_FORCEYES:
      case EnigmailConstants.ENIG_FINAL_YES:
        replyEncrypt.checked = true;
        break;
    }
    switch (Enigmail.msg.statusSigned) {
      case EnigmailConstants.ENIG_FINAL_FORCEYES:
      case EnigmailConstants.ENIG_FINAL_YES:
        replySign.checked = true;
        break;
    }
    switch (Enigmail.msg.statusPGPMime) {
      case EnigmailConstants.ENIG_FINAL_FORCEYES:
      case EnigmailConstants.ENIG_FINAL_YES:
        replyPgpMime.checked = true;
        break;
    }
    // Set reasons to checkboxes
    replyEncrypt.setAttribute("title", Enigmail.msg.reasonEncrypted);
    replySign.setAttribute("title", Enigmail.msg.reasonSigned);

    // Add listeners to set final mode
    if (!aMessage._conversation._enigmailReplyEventListener) {
      aMessage._conversation._enigmailReplyEventListener = true;
      replyEncrypt.addEventListener('click', function () {
        if (this.checked) {
          Enigmail.msg.encryptForced = EnigmailConstants.ENIG_ALWAYS; // force to encrypt
        } else {
          Enigmail.msg.encryptForced = EnigmailConstants.ENIG_NEVER; // force not to encrypt
        }
      });
      replySign.addEventListener('click', function () {
        if (this.checked) {
          Enigmail.msg.signingNoLongerDependsOnEnc();
          Enigmail.msg.signForced = EnigmailConstants.ENIG_ALWAYS; // force to sign
        } else {
          Enigmail.msg.signingNoLongerDependsOnEnc();
          Enigmail.msg.signForced = EnigmailConstants.ENIG_NEVER; // force not to sign
        }
      });
      replyPgpMime.addEventListener('click', function () {
        if (this.checked) {
          Enigmail.msg.pgpmimeForced = EnigmailConstants.ENIG_ALWAYS; // force to PGP/Mime
        } else {
          Enigmail.msg.pgpmimeForced = EnigmailConstants.ENIG_NEVER; // force not to PGP/Mime
        }
      });
    }

    if (!aMessage.decryptedText)
      return;

    // Replace inline PGP body to decrypted body.
    let waitLoadingBody = function (complete) {
      window.setTimeout(function () {
        if (aEditor.node.contentDocument.querySelector("blockquote").length === 0) {
          waitLoadingBody(complete);
        } else {
           complete();
        };
      }, 200);
    };
    waitLoadingBody(function () {
      aEditor.node.contentDocument.querySelector("blockquote").innerHTML =
        escapeHtml(aMessage.decryptedText).replace(/\r?\n/g, '<br>');
    });
  },

  // Update security info when the message is selected.
  onMessageSelected: function _enigmailHook_onMessageSelected(aMessage) {
    if (hasEnigmail) {
      updateSecurityInfo(aMessage);
    }
  },
}

registerHook(enigmailHook);
