import Hls from 'hls.js';

import React, { Component } from 'react'

import { getSDK, isMediaStream, supportsWebKitPresentationMode } from '../utils'
import { canPlay, AUDIO_EXTENSIONS, HLS_EXTENSIONS, DASH_EXTENSIONS, FLV_EXTENSIONS } from '../patterns'

const HAS_NAVIGATOR = typeof navigator !== 'undefined'
const IS_IPAD_PRO = HAS_NAVIGATOR && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
const IS_IOS = HAS_NAVIGATOR && (/iPad|iPhone|iPod/.test(navigator.userAgent) || IS_IPAD_PRO) && !window.MSStream
const IS_SAFARI = HAS_NAVIGATOR && (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) && !window.MSStream

export default class FilePlayer extends Component {
  static displayName = 'FilePlayer'
  static canPlay = canPlay.file

  componentDidMount () {
    this.props.onMount && this.props.onMount(this)
    this.addListeners(this.player)
    const src = this.getSource(this.props.url) // Ensure src is set in strict mode
    if (src) {
      this.player.src = src
    }
    if (IS_IOS || this.props.config.forceDisableHls) {
      this.player.load()
    }
  }

  componentDidUpdate (prevProps) {
    if (this.shouldUseAudio(this.props) !== this.shouldUseAudio(prevProps)) {
      this.removeListeners(this.prevPlayer, prevProps.url)
      this.addListeners(this.player)
    }

    if (
      this.props.url !== prevProps.url &&
      !isMediaStream(this.props.url) &&
      !(this.props.url instanceof Array) // Avoid infinite loop
    ) {
      this.player.srcObject = null
    }
  }

  componentWillUnmount () {
    this.player.removeAttribute('src')
    this.removeListeners(this.player)
    if (this.hls) {
      this.hls.destroy()
    }
  }

  addListeners (player) {
    const { url, playsinline } = this.props
    player.addEventListener('play', this.onPlay)
    player.addEventListener('waiting', this.onBuffer)
    player.addEventListener('playing', this.onBufferEnd)
    player.addEventListener('pause', this.onPause)
    player.addEventListener('seeked', this.onSeek)
    player.addEventListener('ended', this.onEnded)
    player.addEventListener('error', this.onError)
    player.addEventListener('ratechange', this.onPlayBackRateChange)
    player.addEventListener('enterpictureinpicture', this.onEnablePIP)
    player.addEventListener('leavepictureinpicture', this.onDisablePIP)
    player.addEventListener('webkitpresentationmodechanged', this.onPresentationModeChange)
    if (!this.shouldUseHLS(url)) { // onReady is handled by hls.js
      player.addEventListener('canplay', this.onReady)
    }
    if (playsinline) {
      player.setAttribute('playsinline', '')
      player.setAttribute('webkit-playsinline', '')
      player.setAttribute('x5-playsinline', '')
    }
  }

  removeListeners (player, url) {
    player.removeEventListener('canplay', this.onReady)
    player.removeEventListener('play', this.onPlay)
    player.removeEventListener('waiting', this.onBuffer)
    player.removeEventListener('playing', this.onBufferEnd)
    player.removeEventListener('pause', this.onPause)
    player.removeEventListener('seeked', this.onSeek)
    player.removeEventListener('ended', this.onEnded)
    player.removeEventListener('error', this.onError)
    player.removeEventListener('ratechange', this.onPlayBackRateChange)
    player.removeEventListener('enterpictureinpicture', this.onEnablePIP)
    player.removeEventListener('leavepictureinpicture', this.onDisablePIP)
    player.removeEventListener('webkitpresentationmodechanged', this.onPresentationModeChange)
    if (!this.shouldUseHLS(url)) { // onReady is handled by hls.js
      player.removeEventListener('canplay', this.onReady)
    }
  }

  // Proxy methods to prevent listener leaks
  onReady = (...args) => this.props.onReady(...args)
  onPlay = (...args) => this.props.onPlay(...args)
  onBuffer = (...args) => this.props.onBuffer(...args)
  onBufferEnd = (...args) => this.props.onBufferEnd(...args)
  onPause = (...args) => this.props.onPause(...args)
  onEnded = (...args) => this.props.onEnded(...args)
  onError = (...args) => this.props.onError(...args)
  onPlayBackRateChange = (event) => this.props.onPlaybackRateChange(event.target.playbackRate)
  onEnablePIP = (...args) => this.props.onEnablePIP(...args)

  onDisablePIP = e => {
    const { onDisablePIP, playing } = this.props
    onDisablePIP(e)
    if (playing) {
      this.play()
    }
  }

  onPresentationModeChange = e => {
    if (this.player && supportsWebKitPresentationMode(this.player)) {
      const { webkitPresentationMode } = this.player
      if (webkitPresentationMode === 'picture-in-picture') {
        this.onEnablePIP(e)
      } else if (webkitPresentationMode === 'inline') {
        this.onDisablePIP(e)
      }
    }
  }

  onSeek = e => {
    this.props.onSeek(e.target.currentTime)
  }

  shouldUseAudio (props) {
    if (props.config.forceVideo) {
      return false
    }
    if (props.config.attributes.poster) {
      return false // Use <video> so that poster is shown
    }
    return AUDIO_EXTENSIONS.test(props.url) || props.config.forceAudio
  }

  shouldUseHLS (url) {
    if ((IS_SAFARI && this.props.config.forceSafariHLS) || this.props.config.forceHLS) {
      return true
    }
    if (IS_IOS || this.props.config.forceDisableHls) {
      return false
    }
    return HLS_EXTENSIONS.test(url)
  }

  shouldUseDASH (url) {
    return DASH_EXTENSIONS.test(url) || this.props.config.forceDASH
  }

  shouldUseFLV (url) {
    return FLV_EXTENSIONS.test(url) || this.props.config.forceFLV
  }

  load (url) {
    const { hlsVersion, hlsOptions } = this.props.config
    if (this.hls) {
      this.hls.destroy()
    }
    if (this.dash) {
      this.dash.reset()
    }
    if (this.shouldUseHLS(url)) {
      this.hls = new Hls(hlsOptions)
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.props.onReady()
      })
      this.hls.on(Hls.Events.ERROR, (e, data) => {
        this.props.onError(e, data, this.hls, Hls)
      })
      this.hls.loadSource(url)
      this.hls.attachMedia(this.player)
      this.props.onLoaded()
    }

    if (url instanceof Array) {
      // When setting new urls (<source>) on an already loaded video,
      // HTMLMediaElement.load() is needed to reset the media element
      // and restart the media resource. Just replacing children source
      // dom nodes is not enough
      this.player.load()
    } else if (isMediaStream(url)) {
      try {
        this.player.srcObject = url
      } catch (e) {
        this.player.src = window.URL.createObjectURL(url)
      }
    }
  }

  play () {
    const promise = this.player.play()
    if (promise) {
      promise.catch(this.props.onError)
    }
  }

  pause () {
    this.player.pause()
  }

  stop () {
    this.player.removeAttribute('src')
    if (this.dash) {
      this.dash.reset()
    }
  }

  seekTo (seconds, keepPlaying = true) {
    this.player.currentTime = seconds
    if (!keepPlaying) {
      this.pause()
    }
  }

  setVolume (fraction) {
    this.player.volume = fraction
  }

  mute = () => {
    this.player.muted = true
  }

  unmute = () => {
    this.player.muted = false
  }

  enablePIP () {
    if (this.player.requestPictureInPicture && document.pictureInPictureElement !== this.player) {
      this.player.requestPictureInPicture()
    } else if (supportsWebKitPresentationMode(this.player) && this.player.webkitPresentationMode !== 'picture-in-picture') {
      this.player.webkitSetPresentationMode('picture-in-picture')
    }
  }

  disablePIP () {
    if (document.exitPictureInPicture && document.pictureInPictureElement === this.player) {
      document.exitPictureInPicture()
    } else if (supportsWebKitPresentationMode(this.player) && this.player.webkitPresentationMode !== 'inline') {
      this.player.webkitSetPresentationMode('inline')
    }
  }

  setPlaybackRate (rate) {
    try {
      this.player.playbackRate = rate
    } catch (error) {
      this.props.onError(error)
    }
  }

  getDuration () {
    if (!this.player) return null
    const { duration, seekable } = this.player
    // on iOS, live streams return Infinity for the duration
    // so instead we use the end of the seekable timerange
    if (duration === Infinity && seekable.length > 0) {
      return seekable.end(seekable.length - 1)
    }
    return duration
  }

  getCurrentTime () {
    if (!this.player) return null
    return this.player.currentTime
  }

  getSecondsLoaded () {
    if (!this.player) return null
    const { buffered } = this.player
    if (buffered.length === 0) {
      return 0
    }
    const end = buffered.end(buffered.length - 1)
    const duration = this.getDuration()
    if (end > duration) {
      return duration
    }
    return end
  }

  getSource (url) {
    const useHLS = this.shouldUseHLS(url)
    const useDASH = this.shouldUseDASH(url)
    const useFLV = this.shouldUseFLV(url)
    if (url instanceof Array || isMediaStream(url) || useHLS || useDASH || useFLV) {
      return undefined
    }
    return url
  }

  renderSourceElement = (source, index) => {
    if (typeof source === 'string') {
      return <source key={index} src={source} />
    }
    return <source key={index} {...source} />
  }

  renderTrack = (track, index) => {
    return <track key={index} {...track} />
  }

  ref = player => {
    if (this.player) {
      // Store previous player to be used by removeListeners()
      this.prevPlayer = this.player
    }
    this.player = player
  }

  render () {
    const { url, playing, loop, controls, muted, config, width, height } = this.props
    const useAudio = this.shouldUseAudio(this.props)
    const Element = useAudio ? 'audio' : 'video'
    const style = {
      width: width === 'auto' ? width : '100%',
      height: height === 'auto' ? height : '100%'
    }
    return (
      <Element
        ref={this.ref}
        src={this.getSource(url)}
        style={style}
        preload='auto'
        autoPlay={playing || undefined}
        controls={controls}
        muted={muted}
        loop={loop}
        {...config.attributes}
      >
        {url instanceof Array &&
          url.map(this.renderSourceElement)}
        {config.tracks.map(this.renderTrack)}
      </Element>
    )
  }
}
