Editbay: licences
=================

Editbay's own code is under the MIT licence, in Editbay-MIT.txt.

This copy of Editbay also contains FFmpeg and FFprobe, which are licensed
under the GNU General Public License version 3. Because this installer combines
them with Editbay into one distributable, the installer as a whole is conveyed
to you under the GPL version 3, whose full text is in FFmpeg-GPLv3.txt.

What that means for you, in plain terms: you may use this program for anything,
copy it, and pass it on, and you are entitled to the source code of the GPL
parts.


Where the source is
-------------------

Editbay itself:
  https://github.com/ZazaGdev/editbay

FFmpeg 9.0.2, the exact revision this build of FFmpeg and FFprobe was made from:
  https://github.com/FFmpeg/FFmpeg/commit/946fcce07b

The Windows build and the options it was configured with:
  https://www.gyan.dev/ffmpeg/builds/

FFmpeg-build-and-source.txt, beside this file, is the build's own record of its
version, its source commit and its full configuration, exactly as its publisher
wrote it.

Written offer for the complete source (GPL version 3, section 6(b))
-------------------------------------------------------------------

The complete source of FFmpeg and FFprobe as built here also includes the
libraries they contain and the scripts used to build them. For at least three
years from the date you received this installer, and for as long as this version
is offered, anyone who has it may ask for that complete source:

  by email:  zazagdev@gmail.com
  or as an issue:  https://github.com/ZazaGdev/editbay/issues

It will be provided as a download at no charge, or on a physical medium for no
more than the cost of making and sending it.


The rest
--------

FFprobe, which reads what a video file contains, comes from the same build as
FFmpeg, and like it is licensed under the GNU General Public License version 3.

Montserrat, the font captions are drawn with unless another is chosen, and
Anton, Bebas Neue and Poppins, the other caption fonts, are used under the SIL
Open Font License 1.1. Their full texts and copyright notices are in
Montserrat-OFL.txt, Anton-OFL.txt, BebasNeue-OFL.txt and Poppins-OFL.txt.

ONNX Runtime, which runs the face model for Follow face, and YuNet, that face
model, are MIT licensed. Their full texts and copyright notices are in
ONNXRuntime-MIT.txt and YuNet-MIT.txt, and the libraries built into ONNX
Runtime are listed in ONNXRuntime-ThirdPartyNotices.txt.

React (with its scheduler) and the lucide icons are built into Editbay's own
code. Their licences are React-MIT.txt and lucide-ISC.txt.

whisper.cpp and its speech model are not part of this installer. They are
downloaded once, only if you ask Editbay for captions, and both are MIT
licensed. See THIRD-PARTY-NOTICES.md, beside this file, for versions and links.

Electron, React and the other libraries Editbay is built from are listed with
their licences in THIRD-PARTY-NOTICES.md, beside this file. Electron's and
Chromium's own notices are LICENSE.electron.txt and LICENSES.chromium.html,
beside Editbay.exe.
